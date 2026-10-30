"""The MCP token never reaches logs, and tests never reach the live MCP server."""

from __future__ import annotations

import io
import logging
from urllib.parse import quote

from app.core.config import settings
from app.core.log_redaction import REDACTED
from app.services import mcp_client
from tests.conftest import TEST_MCP_TOKEN, TEST_MCP_URL

FAKE_TOKEN = "s3cr3t-Token/with+special&chars=123"


def test_tests_never_use_the_live_mcp_server():
    """conftest forces a dummy, unreachable MCP address even if backend/.env has the real one."""
    assert settings.mcp_url == TEST_MCP_URL and settings.mcp_token == TEST_MCP_TOKEN
    assert settings.mcp_url.startswith("http://127.0.0.1:9/")
    assert "deodap.db" not in settings.database_url  # never the local database either


def _capture(logger_name: str = "httpx"):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(name)s %(levelname)s %(message)s"))
    logger = logging.getLogger(logger_name)
    logger.addHandler(handler)
    old_level = logger.level
    logger.setLevel(logging.DEBUG)
    return stream, lambda: (logger.removeHandler(handler), logger.setLevel(old_level))


def test_token_is_redacted_from_any_log_line(monkeypatch):
    monkeypatch.setattr(settings, "mcp_token", FAKE_TOKEN)
    stream, done = _capture("httpx")
    try:
        log = logging.getLogger("httpx")
        url = f"https://ship.example/mcp?mcp_token={quote(FAKE_TOKEN, safe='')}"
        log.info(
            f"HTTP Request: POST https://ship.example/mcp?mcp_token={FAKE_TOKEN} 200"
        )  # in the message
        log.info("HTTP Request: %s %s", "POST", url)  # URL-encoded, in the arguments
        log.warning("failed: %(url)s", {"url": f"x?mcp_token={FAKE_TOKEN}"})  # mapping arguments
        try:
            raise RuntimeError(
                f"Client error '401' for url 'https://ship.example/mcp?mcp_token={FAKE_TOKEN}'"
            )
        except RuntimeError:
            log.exception("call failed")  # in the traceback
    finally:
        done()
    output = stream.getvalue()
    assert FAKE_TOKEN not in output and quote(FAKE_TOKEN, safe="") not in output
    assert "s3cr" not in output  # not even the first characters
    assert output.count(REDACTED) >= 4
    assert "Client error '401'" in output  # the useful part of the error is kept


def test_mask_shows_no_part_of_the_token(monkeypatch):
    monkeypatch.setattr(settings, "mcp_token", FAKE_TOKEN)
    masked = mcp_client._mask(f"connect https://ship.example/mcp?mcp_token={FAKE_TOKEN}")
    assert FAKE_TOKEN not in masked and "s3cr" not in masked and "(masked)" in masked


def test_short_or_empty_values_are_not_redacted(monkeypatch):
    monkeypatch.setattr(settings, "mcp_token", "")
    stream, done = _capture("perf")
    try:
        logging.getLogger("perf").info("ordinary message")
    finally:
        done()
    assert stream.getvalue().strip().endswith("ordinary message")

"""Keep secrets (the MCP token) out of every log line, whichever library writes it.

The Ship MCP server authenticates with the token in the connect URL (``?mcp_token=...``), so any
log line or traceback that shows a URL could carry it: httpx's request log, an exception message,
a traceback logged by uvicorn. A log-record factory rewrites every record as it is created:
message, arguments and the formatted traceback, replacing the secret (plain or URL-encoded) with
"[redacted]". Installed once at startup (app.main), before anything logs.
"""

from __future__ import annotations

import logging
import traceback
from collections.abc import Callable
from urllib.parse import quote, quote_plus

REDACTED = "[redacted]"
MIN_SECRET_LENGTH = 8  # never "redact" short or empty values

_installed = False


def _variants(secrets: list[str]) -> list[str]:
    out: set[str] = set()
    for secret in secrets:
        if secret and len(secret) >= MIN_SECRET_LENGTH:
            out.update({secret, quote(secret, safe=""), quote_plus(secret)})
    return sorted(out, key=len, reverse=True)


def redact(text: str, secrets: list[str]) -> str:
    for variant in _variants(secrets):
        text = text.replace(variant, REDACTED)
    return text


def _contains(value: object, variants: list[str]) -> bool:
    text = str(value)
    return any(v in text for v in variants)


def install_secret_redaction(get_secrets: Callable[[], list[str]]) -> None:
    """Wrap the logging record factory so each record is cleaned when it is created."""
    global _installed
    if _installed:
        return
    previous = logging.getLogRecordFactory()

    def factory(*args, **kwargs) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        secrets = get_secrets()
        variants = _variants(secrets)
        if not variants:
            return record
        try:
            if isinstance(record.msg, str):
                record.msg = redact(record.msg, secrets)
            elif _contains(record.msg, variants):
                record.msg = redact(str(record.msg), secrets)
            if isinstance(record.args, tuple):
                record.args = tuple(
                    redact(str(a), secrets) if _contains(a, variants) else a for a in record.args
                )
            elif isinstance(record.args, dict):
                record.args = {
                    k: redact(str(v), secrets) if _contains(v, variants) else v
                    for k, v in record.args.items()
                }
            if record.exc_info and record.exc_info[0] is not None:
                # Formatters reuse exc_text when it is set: pre-format the traceback, cleaned.
                record.exc_text = redact(
                    "".join(traceback.format_exception(*record.exc_info)).rstrip(), secrets
                )
            if record.stack_info:
                record.stack_info = redact(record.stack_info, secrets)
        except Exception:  # never let redaction break logging
            pass
        return record

    logging.setLogRecordFactory(factory)
    _installed = True

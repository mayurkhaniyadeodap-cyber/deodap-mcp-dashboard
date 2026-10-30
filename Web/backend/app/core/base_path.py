"""Public URL sub-path the current request came through (see settings.public_base_paths).

The reverse proxy strips the sub-path before forwarding (so routes stay "/api/...", "/assets/...")
and says which one it was in `X-Forwarded-Prefix`. Only allow-listed values count: the prefix is
written into the served HTML and the cookie path, so a forged header can never inject markup.
"""

import re
from collections.abc import Mapping

from app.core.config import settings

PREFIX_HEADER = "x-forwarded-prefix"
_SAFE = re.compile(r"^/[A-Za-z0-9][A-Za-z0-9_-]*$")


def public_prefix(headers: Mapping[str, str]) -> str:
    """The allow-listed public sub-path for this request ("/courier-billing"), else ""."""
    raw = (headers.get(PREFIX_HEADER) or "").strip().rstrip("/")
    if raw and _SAFE.match(raw) and raw in settings.public_base_paths_list:
        return raw
    return ""

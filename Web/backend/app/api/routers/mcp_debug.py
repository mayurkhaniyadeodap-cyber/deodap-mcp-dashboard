"""TEMPORARY MCP debug endpoints (remove after the pilot).

  GET /api/_mcp/tools           → each tool's name, description, input schema
  GET /api/_mcp/probe?tool=...  → call a tool with inferred minimal args, raw response

Intentionally unauthenticated for quick local inspection. Delete this router
(and its include in main.py) once the courier tool is wired up.
"""

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.services import mcp_client

router = APIRouter(tags=["_mcp_debug"])


def _to_jsonable(obj: Any) -> Any:
    """Best-effort conversion of MCP result objects to plain JSON."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if isinstance(obj, list):
        return [_to_jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    return obj


@router.get("/_mcp/tools")
async def mcp_tools() -> dict:
    try:
        tools = await mcp_client.list_tools()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"MCP error: {exc}") from exc
    return {
        "count": len(tools),
        "tools": [
            {"name": t.name, "description": t.description, "input_schema": t.inputSchema}
            for t in tools
        ],
    }


# Field-name hints for schema-aware default inference.
_DATE_HINTS = ("from", "to", "start", "end", "date", "since", "until")


def _infer_arguments(schema: dict) -> dict:
    """Build minimal valid args from a JSON schema.

    - No required params → {} (server defaults apply).
    - Required date-range fields → last 30 days (ISO).
    - Required enums/strings → first allowed value / sensible default.
    """
    props: dict = (schema or {}).get("properties", {}) or {}
    required: list[str] = (schema or {}).get("required", []) or []
    if not required:
        return {}

    today = date.today()
    args: dict = {}
    for name in required:
        spec = props.get(name, {})
        lname = name.lower()
        enum = spec.get("enum")
        if enum:
            args[name] = enum[0]
        elif any(h in lname for h in ("to", "end", "until")):
            args[name] = today.isoformat()
        elif any(h in lname for h in ("from", "start", "since")) or "date" in lname:
            args[name] = (today - timedelta(days=30)).isoformat()
        else:
            t = spec.get("type")
            t = t[0] if isinstance(t, list) else t
            args[name] = {"integer": 0, "number": 0, "boolean": False, "array": [], "object": {}}.get(t, "")
    return args


@router.get("/_mcp/probe")
async def mcp_probe(tool: str = Query(..., description="Exact tool name from /_mcp/tools")) -> dict:
    # Never guess the tool name — validate against the live list first.
    try:
        tools = await mcp_client.list_tools()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"MCP error: {exc}") from exc

    match = next((t for t in tools if t.name == tool), None)
    if match is None:
        raise HTTPException(status_code=404, detail=f"Unknown tool '{tool}'. Available: {[t.name for t in tools]}")

    schema = match.inputSchema or {}
    args = _infer_arguments(schema)

    # If a required param couldn't be inferred, stop and show the schema.
    required = schema.get("required", []) or []
    missing = [r for r in required if r not in args]
    if missing:
        return {"tool": tool, "needs_input": missing, "input_schema": schema,
                "message": "Required params with no inferable default — provide them manually."}

    try:
        result = await mcp_client.call_tool(tool, args)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"MCP call failed: {exc}") from exc

    return {"tool": tool, "arguments_sent": args, "raw_response": _to_jsonable(result)}

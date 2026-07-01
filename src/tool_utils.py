"""
This module intentionally imports NOTHING from the project (except
src.constants which imports nothing from src). Adding a project import here
will reintroduce the circular dependency that this module exists to break.
"""

import json
import re

from src.constants import MAX_OUTPUT_CHARS

_mcp_manager = None

# ---------------------------------------------------------------------------
# MCP Manager singleton
# ---------------------------------------------------------------------------

def set_mcp_manager(manager):
    """Set the global MCP manager instance."""
    global _mcp_manager
    _mcp_manager = manager

def get_mcp_manager():
    """Get the global MCP manager instance."""
    return _mcp_manager

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    """
    Truncate text to *limit* characters with a suffix note.

    Callers treat the result as text, so always return a string: coerce a
    non-string (None -> "", otherwise str(...)) instead of returning it raw,
    which would just move the crash downstream.
    """
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    if len(text) > limit:
        return text[:limit] + f"\n... (truncated, {len(text)} chars total)"
    return text


# A leading action token some models emit *outside* the JSON body, e.g.
# `add {"title": ...}` or `<<<add>>> {"title": ...}`. Native tool-call
# endpoints pass this straight through as the arguments string, so a bare
# json.loads would blow up with "Invalid JSON arguments" even though the
# intent is obvious. Captured so we can fold it back in as {"action": ...}.
_ACTION_PREFIX_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")


def _recover_prefixed_json(text):
    """Best-effort recovery for a JSON object preceded by an action keyword.

    Handles the shapes models emit when they treat the action as a verb in
    front of the argument object instead of a field inside it::

        add {"title": "..."}
        <<<add>>> {"title": "..."}
        create: {"summary": "..."}

    Returns a dict (with ``action`` injected from the prefix when the body
    doesn't already carry one) or ``None`` when nothing usable is found. Only
    reached on the json.loads failure path, so it can never change the result
    of an already-valid call — it only rescues one that would otherwise error.
    """
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start:end + 1])
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    # Fold a leading `add` / `<<<add>>>` / `create:` verb back into the body.
    prefix = text[:start].strip().strip("<>`'\":").strip()
    if prefix and not parsed.get("action") and _ACTION_PREFIX_TOKEN_RE.match(prefix):
        parsed["action"] = prefix.lower()
    return parsed


def _parse_tool_args(content):
    """Parse a tool-call argument blob.

    Accepts either a JSON string or an already-decoded dict. Unwraps the
    common `{"body": {...}}` envelope that smaller models emit when they
    read tool descriptions like "Body is JSON: {...}" literally and
    pass `body` as a field name rather than treating it as a noun.

    Also recovers the `action {json}` / `<<<action>>> {json}` shape some
    models emit (the action verb placed outside the object) before giving up.

    Returns a dict on success, raises ValueError on bad JSON.
    """
    if isinstance(content, str):
        try:
            args = json.loads(content) if content.strip() else {}
        except (json.JSONDecodeError, TypeError) as e:
            recovered = _recover_prefixed_json(content)
            if recovered is None:
                raise ValueError(str(e))
            args = recovered
    elif isinstance(content, dict):
        args = content
    else:
        args = {}
    # Unwrap {"body": {...}} envelope, but only if `body` is the sole key
    # and points at a dict. We don't want to clobber a legitimate `body`
    # field on tools where it's a real arg (e.g. send_email body text).
    if (
        isinstance(args, dict)
        and len(args) == 1
        and "body" in args
        and isinstance(args["body"], dict)
        and "action" in args["body"]  # extra safety: only unwrap if the inner dict looks like a tool call
    ):
        args = args["body"]
    return args

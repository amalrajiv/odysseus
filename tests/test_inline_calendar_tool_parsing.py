"""Models sometimes leak manage_calendar as inline backticks or single-line fences."""
import json
import sys
from unittest.mock import MagicMock

for mod in ['src.agent_tools', 'src.tool_parsing', 'src.tool_schemas', 'src.tool_execution']:
    sys.modules.pop(mod, None)
for mod in [
    'sqlalchemy', 'sqlalchemy.orm', 'sqlalchemy.ext', 'sqlalchemy.ext.declarative',
    'sqlalchemy.ext.hybrid', 'sqlalchemy.sql', 'sqlalchemy.sql.expression',
    'src.database', 'core.models', 'core.database', 'core.auth'
]:
    if mod not in sys.modules:
        sys.modules[mod] = MagicMock()

import src.agent_tools  # noqa: E402, F401
from src.tool_parsing import parse_tool_blocks, strip_tool_blocks  # noqa: E402


def test_inline_backtick_manage_calendar_list_action():
    text = '`manage_calendar {"action": "list"}`'
    blocks = parse_tool_blocks(text)
    assert len(blocks) == 1
    assert blocks[0].tool_type == "manage_calendar"
    assert json.loads(blocks[0].content)["action"] == "list"


def test_double_backtick_manage_calendar():
    text = '``manage_calendar {"action": "list_events"}``'
    blocks = parse_tool_blocks(text)
    assert len(blocks) == 1
    assert blocks[0].tool_type == "manage_calendar"
    assert json.loads(blocks[0].content)["action"] == "list_events"


def test_single_line_fenced_manage_calendar():
    text = '```manage_calendar {"action": "list_events"}```'
    blocks = parse_tool_blocks(text)
    assert len(blocks) == 1
    assert blocks[0].tool_type == "manage_calendar"
    assert json.loads(blocks[0].content)["action"] == "list_events"


def test_standalone_line_manage_calendar():
    text = 'manage_calendar {"action": "list_events"}'
    blocks = parse_tool_blocks(text)
    assert len(blocks) == 1
    assert blocks[0].tool_type == "manage_calendar"


def test_inline_calendar_parsed_even_when_skip_fenced():
    text = '`manage_calendar {"action": "list_events"}`'
    blocks = parse_tool_blocks(text, skip_fenced=True)
    assert len(blocks) == 1
    assert blocks[0].tool_type == "manage_calendar"


def test_strip_inline_manage_calendar():
    text = 'Here you go:\n`manage_calendar {"action": "list"}`'
    cleaned = strip_tool_blocks(text)
    assert "manage_calendar" not in cleaned
    assert '{"action"' not in cleaned

"""Post-tool nudge + prompt guidance for manage_calendar list_events reads."""
from src.agent_loop import TOOL_SECTIONS, _assemble_prompt, _section_text
from src.tool_execution import format_tool_result


def test_format_tool_result_nudges_calendar_list_success():
    out = format_tool_result(
        "manage_calendar",
        {
            "response": "Found 3 event(s) between 2026-07-01 and 2026-07-31:",
            "events": [{"uid": "abc", "summary": "Meet"}],
            "exit_code": 0,
        },
    )
    assert "Calendar list succeeded" in out
    assert "Do not re-call list_events" in out
    assert "grouped by date" in out


def test_format_tool_result_nudges_calendar_empty_list():
    out = format_tool_result(
        "manage_calendar",
        {
            "response": "No events between 2026-07-01 and 2026-07-31.",
            "exit_code": 0,
        },
    )
    assert "Calendar list succeeded" in out
    assert "no events in that range" in out


def test_manage_calendar_tool_section_shows_month_list_example():
    section = _section_text("manage_calendar", TOOL_SECTIONS["manage_calendar"])
    assert '"start": "2026-07-01"' in section
    assert '"end": "2026-08-01"' in section
    assert "this month" in section.lower() or "first day of next month" in section


def test_compact_prompt_mentions_list_events_month_range():
    prompt = _assemble_prompt({"manage_calendar"}, compact=True)
    assert "list_events" in prompt
    assert "this month" in prompt.lower() or "first day" in prompt

"""Compact/local prompts must expose create_event, not just list_events."""
from src.agent_loop import (
    TOOL_SECTIONS,
    _DOMAIN_RULES,
    _assemble_prompt,
    _compact_tool_line,
    _section_text,
)


def test_compact_manage_calendar_includes_create_and_list_examples():
    section = _section_text("manage_calendar", TOOL_SECTIONS["manage_calendar"])
    line = _compact_tool_line("manage_calendar", section)
    assert "create_event" in line
    assert "list_events" in line
    assert "all_day" in line
    assert "Personal" in line


def test_compact_manage_calendar_leads_with_create_example():
    section = _section_text("manage_calendar", TOOL_SECTIONS["manage_calendar"])
    line = _compact_tool_line("manage_calendar", section)
    assert line.index("create_event") < line.index("list_events")


def test_domain_rules_skip_list_calendars_when_user_names_calendar():
    rules = _DOMAIN_RULES["notes_calendar_tasks"]
    assert "only call `list_calendars` when the calendar is unknown" in rules
    assert 'calendar: "Personal"' in rules
    assert "all_day: true" in rules


def test_assembled_compact_prompt_includes_calendar_write_guidance():
    prompt = _assemble_prompt({"manage_calendar"}, compact=True)
    assert "create_event" in prompt
    assert "all_day" in prompt
    assert "only call `list_calendars` when the calendar is unknown" in prompt

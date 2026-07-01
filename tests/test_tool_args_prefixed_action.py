"""_parse_tool_args must recover the `action {json}` shape models emit.

Some models (and native tool-call endpoints on local runtimes) place the
action verb *outside* the JSON object, e.g. ``add {"title": ...}`` or
``<<<add>>> {"title": ...}``. A bare json.loads rejects that with
"Invalid JSON arguments", which is exactly what broke a calendar create in
the wild. We fold the leading verb back in as {"action": ...} instead.
"""
import pytest

from src.tool_utils import _parse_tool_args


def test_bare_action_word_prefix_is_folded_into_action():
    args = _parse_tool_args('add {"title": "x"}')
    assert args == {"title": "x", "action": "add"}


def test_angle_wrapped_action_prefix_is_folded_into_action():
    args = _parse_tool_args(
        '<<<add>>> {"title": "x", "datetime_local": "2026-07-03T11:30:00+05:30", "duration_minutes": 60}'
    )
    assert args["action"] == "add"
    assert args["title"] == "x"
    assert args["duration_minutes"] == 60


def test_colon_action_prefix_is_folded_into_action():
    assert _parse_tool_args('create: {"summary": "y"}') == {"summary": "y", "action": "create"}


def test_existing_action_is_not_overwritten_by_prefix():
    # A body that already declares an action wins over any leading verb.
    args = _parse_tool_args('delete {"action": "create_event", "summary": "z"}')
    assert args["action"] == "create_event"


def test_valid_json_is_unchanged():
    assert _parse_tool_args('{"action": "add", "title": "x"}') == {"action": "add", "title": "x"}


def test_plain_json_without_prefix_is_unchanged():
    assert _parse_tool_args('{"summary": "no action here"}') == {"summary": "no action here"}


def test_truly_broken_input_still_raises():
    with pytest.raises(ValueError):
        _parse_tool_args("not json at all")


def test_prefix_without_any_object_still_raises():
    with pytest.raises(ValueError):
        _parse_tool_args("add")


def test_empty_string_is_empty_dict():
    assert _parse_tool_args("") == {}

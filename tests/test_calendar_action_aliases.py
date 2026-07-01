"""manage_calendar action aliases like list/events/upcoming → list_events."""
import json
import sys
import tempfile
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

import core.database as cdb

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)


@pytest.fixture(autouse=True)
def _bind_temp_db(monkeypatch):
    monkeypatch.setitem(sys.modules, "core.database", cdb)
    parent = sys.modules.get("core")
    if parent is not None:
        monkeypatch.setattr(parent, "database", cdb, raising=False)
    monkeypatch.setattr(cdb, "SessionLocal", _TS)
    yield


@pytest.mark.parametrize("action", ["list", "events", "upcoming"])
async def test_read_aliases_map_to_list_events(action):
    from src.tool_implementations import do_manage_calendar

    owner = "cal-alias-" + uuid.uuid4().hex[:8]
    res = await do_manage_calendar(json.dumps({"action": action}), owner=owner)
    assert res.get("exit_code", 0) == 0, res
    assert "events" in res.get("response", "").lower() or "No events" in res.get("response", "")


@pytest.mark.parametrize("action", ["add", "new", "schedule", "create", "add_event"])
async def test_write_aliases_map_to_create_event(action):
    from src.tool_implementations import do_manage_calendar

    owner = "cal-write-" + uuid.uuid4().hex[:8]
    res = await do_manage_calendar(
        json.dumps({
            "action": action,
            "summary": f"Meeting {action}",
            "dtstart": "2026-07-03T11:30:00+05:30",
        }),
        owner=owner,
    )
    assert res.get("exit_code", 0) == 0, res
    assert res.get("uid"), res


async def test_create_event_accepts_title_datetime_local_and_duration_minutes():
    # The exact field names the model used in the wild: title (not summary),
    # datetime_local (not dtstart), duration_minutes (not a "1h" duration string).
    from src.tool_implementations import do_manage_calendar

    owner = "cal-fields-" + uuid.uuid4().hex[:8]
    res = await do_manage_calendar(
        json.dumps({
            "action": "create_event",
            "title": "Dev Leads Meeting - End User App Addition Feature",
            "datetime_local": "2026-07-03T11:30:00+05:30",
            "duration_minutes": 60,
        }),
        owner=owner,
    )
    assert res.get("exit_code", 0) == 0, res
    assert res.get("uid"), res

    listing = await do_manage_calendar(
        json.dumps({"action": "list_events", "start": "2026-07-01", "end": "2026-07-10"}),
        owner=owner,
    )
    events = listing.get("events", [])
    assert len(events) == 1, listing
    ev = events[0]
    assert ev["summary"] == "Dev Leads Meeting - End User App Addition Feature"
    # 11:30 IST (+05:30) == 06:00Z; +60 min duration == 07:00Z.
    assert ev["dtstart"] == "2026-07-03T06:00:00Z"
    assert ev["dtend"] == "2026-07-03T07:00:00Z"


@pytest.mark.parametrize("content_prefix", ["add ", "<<<add>>> "])
async def test_action_verb_outside_json_still_creates_event(content_prefix):
    # Reproduces the failing transcript: the model put the action verb outside
    # the JSON object, e.g. `add {..}` / `<<<add>>> {..}`, which used to fail
    # with "Invalid JSON arguments". _parse_tool_args now recovers it.
    from src.tool_implementations import do_manage_calendar

    owner = "cal-prefix-" + uuid.uuid4().hex[:8]
    body = json.dumps({
        "title": "Dev Leads Meeting - End User App Addition Feature",
        "datetime_local": "2026-07-03T11:30:00+05:30",
        "duration_minutes": 60,
    })
    res = await do_manage_calendar(content_prefix + body, owner=owner)
    assert res.get("error") != "Invalid JSON arguments", res
    assert res.get("exit_code", 0) == 0, res
    assert res.get("uid"), res

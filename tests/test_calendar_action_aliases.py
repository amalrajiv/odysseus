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

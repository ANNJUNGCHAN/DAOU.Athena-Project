"""Backend-wide test isolation for always-available local stores."""

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _isolate_instrument_master(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("ATHENA_INSTRUMENT_DB_PATH", str(tmp_path / "instruments.sqlite3"))

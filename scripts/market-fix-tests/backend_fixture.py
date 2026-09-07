"""Accountless local-only FastAPI fixture for the BOOT001/BOOT002 component gate."""

from __future__ import annotations

import inspect
import os
from contextlib import asynccontextmanager
from pathlib import Path

import athena_api
from athena_api.config import Settings


PRIVATE_ROOT = Path(os.environ["DAOU_FIXTURE_PRIVATE_ROOT"]).resolve()
BACKEND_ROOT = Path(os.environ["DAOU_FIXTURE_BACKEND_ROOT"]).resolve()
ATHENA_API_PATH = Path(inspect.getfile(athena_api)).resolve()
if not ATHENA_API_PATH.is_relative_to(BACKEND_ROOT):
    raise RuntimeError("fixture imported athena_api outside the owned backend root")
if (PRIVATE_ROOT / ".env").exists():
    raise RuntimeError("fixture private root must not contain an environment file")
if Path.cwd().resolve() != PRIVATE_ROOT:
    raise RuntimeError("fixture process cwd must be the owned private root")

# athena_api.main defines its production module-level app while it exposes create_app.
# Import it from the fresh private directory so that transient default construction cannot
# discover backend/.env; the fixture app below still receives _env_file=None explicitly.
from athena_api.main import create_app  # noqa: E402


def synthetic_markets() -> dict[str, list[dict[str, str]]]:
    groups = (("0", 100000, 1200), ("10", 200000, 1200), ("8", 300000, 1125))
    return {
        market: [
            {
                "code": f"{start + offset:06d}",
                "name": f"모의종목{start + offset:06d}",
                "marketCode": market,
            }
            for offset in range(count)
        ]
        for market, start, count in groups
    }


settings = Settings(
    _env_file=None,
    kiwoom_accounts=[],
    kiwoom_app_key=None,
    kiwoom_secret_key=None,
    kiwoom_default_account=None,
    local_bearer_token=None,
    enable_order_api=False,
    brain_enabled=False,
    routines_enabled=False,
    backtest_enabled=False,
    brain_db_path=PRIVATE_ROOT / "brain.sqlite3",
    routines_store_path=PRIVATE_ROOT / "routines.json",
    routines_ledger_path=PRIVATE_ROOT / "ledger.jsonl",
    routines_read_marks_path=PRIVATE_ROOT / "read-marks.json",
    routines_engagement_path=PRIVATE_ROOT / "engagement.jsonl",
    routines_briefings_path=PRIVATE_ROOT / "briefings.jsonl",
    routines_ledger_archive_dir=PRIVATE_ROOT / "archive",
    nudge_guard_path=PRIVATE_ROOT / "nudge-guard.json",
    backtest_db_path=PRIVATE_ROOT / "backtest.sqlite3",
    projects_root=PRIVATE_ROOT / "projects",
)
app = create_app(settings)
production_lifespan = app.router.lifespan_context


@asynccontextmanager
async def fixture_lifespan(application):
    async with production_lifespan(application):
        identity_count = application.state.instrument_identity.replace(synthetic_markets())
        if identity_count != 3525:
            raise RuntimeError(f"synthetic identity count mismatch: {identity_count}")
        application.state.fixture_identity_count = identity_count
        yield


app.router.lifespan_context = fixture_lifespan


@app.get("/__fixture__/metadata", include_in_schema=False)
async def fixture_metadata() -> dict[str, object]:
    return {
        "synthetic": True,
        "identity_count": app.state.fixture_identity_count,
        "account_count": len(app.state.kiwoom_accounts),
        "orders_enabled": settings.enable_order_api,
        "brain_enabled": settings.brain_enabled,
        "routines_enabled": settings.routines_enabled,
        "backtest_enabled": settings.backtest_enabled,
        "athena_api_path": str(ATHENA_API_PATH),
        "backend_root": str(BACKEND_ROOT),
        "cwd_is_private": Path.cwd().resolve() == PRIVATE_ROOT,
    }

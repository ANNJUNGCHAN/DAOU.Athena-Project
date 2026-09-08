"""Read-only access to the backend-owned instrument master."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.selector.instrument_identity import InstrumentIdentityIndex

router = APIRouter(prefix="/api/v1/instruments", tags=["Instruments"])


class InstrumentResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)


class ResolvedInstrument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    name: str
    market_code: str = Field(alias="marketCode")
    kind: Literal["stock", "etf"]


class InstrumentResolveResponse(BaseModel):
    ready: bool
    instrument: ResolvedInstrument | None


class InstrumentStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ready: bool
    size: int
    refreshed_at: str | None = Field(alias="refreshedAt")


def _index(request: Request) -> InstrumentIdentityIndex:
    return request.app.state.instrument_identity


@router.post("/resolve", response_model=InstrumentResolveResponse)
def resolve_instrument(
    payload: InstrumentResolveRequest, request: Request
) -> InstrumentResolveResponse:
    index = _index(request)
    resolved = index.resolve(payload.question)
    instrument = None
    if resolved is not None:
        instrument = ResolvedInstrument(
            code=resolved.code,
            name=resolved.name,
            marketCode=resolved.market,
            kind=resolved.target.entity_kind.value,
        )
    return InstrumentResolveResponse(ready=index.ready, instrument=instrument)


@router.get("/status", response_model=InstrumentStatusResponse)
def instrument_status(request: Request) -> InstrumentStatusResponse:
    index = _index(request)
    ready, size, refreshed_at = index.status()
    return InstrumentStatusResponse(
        ready=ready,
        size=size,
        refreshedAt=refreshed_at,
    )


__all__ = ["router"]

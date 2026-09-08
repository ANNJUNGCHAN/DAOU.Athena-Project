"""루틴이 발화할 때 대화창에 띄울 단일 카드의 영속 계약."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, NoReturn

from pydantic import ValidationError

from athena_api.canvas_card_registry import CanvasCardRegistryError, resolve_canvas_card
from athena_api.canvas_transform import resolve_fixed_card_title
from athena_api.routing_contract import BindingRole
from athena_api.selector import build_operation_catalog


class MainCardValidationError(ValueError):
    """후보가 실행 가능한 읽기 전용 정규 카드 계약과 맞지 않는다."""


@dataclass(frozen=True)
class MainCardDescriptor:
    operation_ref: str
    args: dict[str, Any]
    title: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation_ref": self.operation_ref,
            "args": dict(self.args),
            "title": self.title,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> MainCardDescriptor:
        return cls(
            operation_ref=raw["operation_ref"],
            args=dict(raw["args"]),
            title=raw["title"],
        )


def _fail(message: str) -> NoReturn:
    raise MainCardValidationError(message)


def validate_main_card(raw: Any, *, symbol: str) -> MainCardDescriptor:
    """후보를 조회 전용 selector/Canvas 계약에 맞춰 정규화한다."""
    if not isinstance(raw, dict) or set(raw) != {"operation_ref", "args", "title"}:
        _fail("main_card_candidate는 operation_ref, args, title만 가져야 한다")

    operation_ref = raw.get("operation_ref")
    args = raw.get("args")
    title = raw.get("title")
    if not isinstance(operation_ref, str) or not operation_ref:
        _fail("main_card_candidate.operation_ref는 필수 문자열이다")
    if not isinstance(args, dict):
        _fail("main_card_candidate.args는 객체여야 한다")
    if not isinstance(title, str) or not title:
        _fail("main_card_candidate.title은 필수 문자열이다")

    document = build_operation_catalog().find_exact(operation_ref)
    if document is None or document.kind != "query" or not document.generic_callable:
        _fail("main_card_candidate는 지원되는 읽기 전용 조회 operation이어야 한다")
    if BindingRole.INSTRUMENT_CODE not in document.routing.bindings:
        _fail("main_card_candidate는 루틴 종목을 받는 단일 종목 조회여야 한다")
    aliases = {field.alias or name for name, field in document.request_model.model_fields.items()}
    if "stk_cd" not in aliases or args.get("stk_cd") != symbol:
        _fail("main_card_candidate.args의 stk_cd는 루틴 symbol과 같아야 한다")
    unknown = set(args) - aliases
    if unknown:
        _fail("main_card_candidate.args에 operation 스키마 밖 필드가 있다")
    validation_args = dict(args)
    if validation_args.get("base_dt") == "$today":
        validation_args["base_dt"] = datetime.now(timezone(timedelta(hours=9))).strftime("%Y%m%d")
    try:
        normalized = document.request_model.model_validate(validation_args).model_dump(
            by_alias=True, exclude_none=True
        )
    except ValidationError:
        _fail("main_card_candidate.args가 operation 스키마와 맞지 않는다")
    if normalized.get("stk_cd") != symbol:
        _fail("main_card_candidate.args의 종목이 루틴 symbol과 같아야 한다")

    try:
        resolve_canvas_card(operation_ref)
    except CanvasCardRegistryError:
        _fail("main_card_candidate operation에 지원되는 정규 카드가 없다")
    canonical_title = resolve_fixed_card_title(operation_ref)
    if canonical_title is None:
        _fail("main_card_candidate operation의 정규 카드 제목이 없다")
    # 모델이 붙인 임의 제목을 저장하지 않는다. 사람이 확인하는 후보는 항상
    # operation_ref에서 파생한 고정 카드 제목으로 정규화한다.
    persisted_args = dict(normalized)
    if args.get("base_dt") == "$today":
        persisted_args["base_dt"] = "$today"
    return MainCardDescriptor(operation_ref, persisted_args, canonical_title)

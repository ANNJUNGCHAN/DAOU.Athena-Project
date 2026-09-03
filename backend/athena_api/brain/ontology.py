"""Strict, bounded contracts for the investment-brain graph.

2026-08-25 재설계. graphify(`Graphify-Labs/graphify`)의 방법론을 도메인에 맞춰 옮긴 것으로,
이전 판과 세 가지가 다르다.

1. **`Claim`이 없다.** "왜 그렇게 판단했는가"는 별도 노드가 아니라 관계의 `rationale`
   속성이다. graphify의 추출 프롬프트가 못박은 규칙과 같다 —
   *"Rationale ... store as a `rationale` attribute on the relevant node.
   Do NOT create separate rationale nodes."*

2. **confidence와 출처 티어가 별개 축이다.** `Confidence`는 오직 *얼마나 명시적인가*를
   말한다(graphify의 EXTRACTED/INFERRED/AMBIGUOUS 3단 그대로). *누가 말했는가*는
   `SourceTier`가 따로 답한다. 이 둘을 한 필드에 녹이면 "삼성전자 좋아해"라는 명백한
   발화가 출처가 대화라는 이유만으로 INFERRED로 강등돼 의미가 무너진다.

3. **엣지 동일성이 `(source_entity_id, target_entity_id, kind)`다.** 누적하지 않는다.
   `relation_id()`가 이 셋에서 id를 유도하고 `Relation`이 그 일치를 강제하므로, 같은
   쌍·같은 종류의 관계가 두 행으로 갈라질 수 없다. 시간축은 그래프가 아니라
   `graph_events` 로그가 맡는다.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Final, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

GraphId = Annotated[
    str,
    StringConstraints(
        strict=True, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"
    ),
]
ShortText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=256)]
MAX_DERIVED_TEXT_CHARS: Final = 10_000
MAX_RAW_CHAT_TEXT_CHARS: Final = 20_000
LongText = Annotated[
    str,
    StringConstraints(strict=True, min_length=1, max_length=MAX_RAW_CHAT_TEXT_CHARS),
]
DerivedText = Annotated[
    str,
    StringConstraints(strict=True, min_length=1, max_length=MAX_DERIVED_TEXT_CHARS),
]

# 관계 이름. graphify의 `validate.py`는 `file_type`과 `confidence`만 폐쇄형으로 강제하고
# `relation`은 필수 필드이기만 하면 통과시킨다 — 프롬프트에서 열거하고 저장에서는
# 관용하는 구조다. 검증 실패로 추출 결과를 통째로 잃는 것보다, 모르는 관계 이름을
# 일단 받아두고 나중에 정규화하는 편이 낫다는 판단이다. 우리도 같은 선을 긋는다:
# `RelationKind`는 프롬프트가 제시할 표준 어휘이고, 저장은 이 패턴만 만족하면 받는다.
RelationName = Annotated[
    str, StringConstraints(strict=True, min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
]


# 투자자 노드의 정본 이름. 엔티티 id가 `(종류, 정규화된 이름)`에서 유도되므로 이 값이
# 층마다 어긋나면 투자자가 여러 노드로 갈라지고, 아무것도 터지지 않은 채
# `investor_profile_summary()`만 조용히 빈다. 실제로 이 문자열은 store·extraction·
# ingestion 세 곳에 리터럴로 복제돼 있었다 — 그래서 여기 하나로 모은다.
INVESTOR_PROFILE_NAME: Final = "default"


class EntityKind(StrEnum):
    INVESTOR_PROFILE = "investor_profile"
    SECURITY = "security"
    COMPANY = "company"
    SECTOR = "sector"
    THEME = "theme"
    GOAL = "goal"
    PREFERENCE = "preference"
    RISK_SIGNAL = "risk_signal"


class RelationKind(StrEnum):
    """추출 프롬프트가 모델에게 제시하는 표준 관계 어휘.

    저장층은 이 enum이 아니라 `RelationName`으로 받는다(위 주석 참고). 여기 없는 이름이
    저장됐다는 것은 프롬프트가 지키지 못했다는 신호이고, 그건 거부할 일이 아니라
    측정할 일이다.
    """

    RELATES_TO = "relates_to"
    INTERESTED_IN = "interested_in"
    PREFERS = "prefers"
    OWNS = "owns"
    TRADED = "traded"
    RESEARCHED = "researched"
    BELONGS_TO = "belongs_to"
    EXPOSED_TO = "exposed_to"
    AVOIDS = "avoids"
    TARGETS = "targets"


class SourceKind(StrEnum):
    """그래프를 먹이는 원본 종류.

    `RESEARCH`는 뺐다 — 이전 판에서 이 값을 만들어내는 어댑터가 하나도 없었고
    `EXTRACTABLE_SOURCE_KINDS` 한 줄에만 존재하는 죽은 값이었다.
    `HOLDING`은 새로 넣는다: 실제 보유 현황은 성향의 가장 강한 신호인데 이전 판은
    아예 읽지 않았다.
    """

    CHAT_MESSAGE = "chat_message"
    CONVERSATION = "conversation"
    # 사람이 그래프 화면에서 직접 고친 것(2026-09-03). 추출 대상이 아니다 —
    # 이 소스에는 캘 텍스트가 없고, 이미 결론만 들어 있다.
    MANUAL_EDIT = "manual_edit"
    TRADE = "trade"
    HOLDING = "holding"


class Confidence(StrEnum):
    """관계가 원본에 **얼마나 명시적으로** 있었는가. 출처의 신뢰도가 아니다.

    graphify 추출 프롬프트의 3단을 그대로 쓴다. AMBIGUOUS를 빼지 않고 남기는 것이
    핵심이다 — *"AMBIGUOUS: uncertain — flag for review, do not omit."*
    투자 대화에서 "이거 괜찮은 것 같기도 하고"는 버릴 신호가 아니라 나중에 되물을
    대상이고, 그 되묻기가 `suggest_questions`의 재료가 된다.
    """

    EXTRACTED = "EXTRACTED"
    INFERRED = "INFERRED"
    AMBIGUOUS = "AMBIGUOUS"


class SourceTier(StrEnum):
    """관계를 만든 층. 쓰기 충돌의 우선순위를 정한다.

    `DETERMINISTIC`은 체결·잔고처럼 해석의 여지가 없는 사실에서 기계적으로 유도한 것,
    `CONVERSATIONAL`은 대화에서 LLM이 추론한 것이다. graphify가 AST 노드와 LLM 노드가
    충돌할 때 AST를 정본으로 삼고 LLM 쪽을 ghost로 제거하는 것과 같은 규칙이며,
    `GraphStore.apply_extraction`이 이 값으로 승자를 정한다.
    """

    DETERMINISTIC = "deterministic"
    CONVERSATIONAL = "conversational"
    # 사람이 화면에서 직접 고친 것(2026-09-03 사용자 확정 "내가 그래프창에 있으면
    # 편집이라고 봐야지"). 대화 추론보다 세다 — 주인이 명시적으로 말한 것이라
    # 다음 대화 추출이 덮으면 안 된다(store._apply_one_relation이 그것을 막는다).
    # 체결·잔고와는 서로 덮지 않는다: 둘 다 근거가 분명하고, 어긋나면 그 대조를
    # 화면이 보여 주는 것이 이 그래프의 원래 목적이다.
    MANUAL = "manual"


class GraphEventOp(StrEnum):
    """`graph_events`에 남는 변경 종류.

    `ENTITY_MERGED`가 포함된 이유: dedup이 두 엔티티를 합치는 것도 그래프의 역사다.
    나중에 "왜 이 노드가 사라졌지"를 답할 수 있어야 한다.
    """

    ENTITY_ADDED = "entity_added"
    ENTITY_MERGED = "entity_merged"
    EDGE_ADDED = "edge_added"
    EDGE_REMOVED = "edge_removed"
    EDGE_CHANGED = "edge_changed"
    # 티어 우선순위에 밀려 그래프에 반영되지 않은 주장. 이 값이 없으면 "말과 행동이
    # 어긋났다"는 신호가 **쓰기 순서에 따라** 사라진다 — 대화가 먼저 쓰였으면
    # EDGE_ADDED로 남지만, 체결이 먼저면 진 쪽은 흔적도 없이 버려진다. 그 비대칭이
    # 실제로 있었고(leaf 4 실측), 여기서 닫는다.
    EDGE_REJECTED = "edge_rejected"


def normalize_identity(value: str) -> str:
    """엔티티 이름을 동일성 판정용으로 접는다.

    NFKC와 casefold는 서로 멱등이 아니라서 순서가 결과를 바꾼다. 여기서는 한 번씩만
    적용하고 공백만 접는다 — 더 공격적인 정규화(퍼지 병합)는 dedup 계층의 일이고,
    id 유도는 예측 가능해야 한다.
    """
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def _digest(prefix: str, *parts: str) -> str:
    canonical = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    return f"{prefix}:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def entity_id(kind: EntityKind | str, name: str) -> str:
    """`(종류, 정규화된 이름)`에서 유도한 결정적 엔티티 id."""
    kind_value = kind.value if isinstance(kind, EntityKind) else str(kind)
    return _digest("entity", kind_value, normalize_identity(name))


def relation_id(kind: str, source_entity_id: str, target_entity_id: str) -> str:
    """`(종류, 출발, 도착)`에서 유도한 결정적 관계 id.

    출처를 섞지 않는 것이 요점이다. 대화에서 온 `owns`와 잔고에서 온 `owns`가 같은
    엔티티 쌍을 가리키면 **같은 엣지**이고, 둘 중 하나가 이겨야지 두 행으로 남으면
    안 된다. 승자 판정은 `SourceTier`가 한다.
    """
    return _digest("relation", kind, source_entity_id, target_entity_id)


class StrictGraphModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @field_validator("attributes", check_fields=False)
    @classmethod
    def validate_json_safe_attributes(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("attributes must contain only JSON-safe values") from exc
        return value

    @field_validator("text", "rationale", check_fields=False)
    @classmethod
    def reject_blank_text(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("text must not be blank")
        return value

    @field_validator(
        "created_at",
        "updated_at",
        "occurred_at",
        "ingested_at",
        "observed_at",
        "extracted_at",
        "at",
        check_fields=False,
    )
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("timestamp must be UTC-aware")
        return value


class Entity(StrictGraphModel):
    id: GraphId
    kind: EntityKind
    name: ShortText
    aliases: tuple[ShortText, ...] = ()
    attributes: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    @field_validator("name", "aliases")
    @classmethod
    def reject_blank_name(cls, value: Any) -> Any:
        values = value if isinstance(value, tuple) else (value,)
        if any(not item.strip() for item in values):
            raise ValueError("text must not be blank")
        return value

    @model_validator(mode="after")
    def validate_entity(self) -> Self:
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not precede created_at")
        if self.id != entity_id(self.kind, self.name):
            raise ValueError("entity id must be derived from (kind, normalized name)")
        if len(set(self.aliases)) != len(self.aliases):
            raise ValueError("aliases must be unique")
        return self


class SourceRecord(StrictGraphModel):
    id: GraphId
    kind: SourceKind
    text: LongText
    locator: ShortText | None = None
    fingerprint: GraphId
    attributes: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime
    ingested_at: datetime

    @model_validator(mode="after")
    def validate_text_bound(self) -> Self:
        # Raw chat messages are the durable source of truth and may use the larger local
        # API allowance. Every derived/non-chat source keeps the original graph bound;
        # conversation extraction separately uses history.MAX_TRANSCRIPT_CHARS (9,000).
        if self.kind is not SourceKind.CHAT_MESSAGE and len(self.text) > MAX_DERIVED_TEXT_CHARS:
            raise ValueError(
                f"non-chat source text must not exceed {MAX_DERIVED_TEXT_CHARS} characters"
            )
        return self


class Relation(StrictGraphModel):
    """엔티티 사이의 단일 엣지.

    `source_id`가 튜플이 아니라 단일 값인 것은 의도다. 적재는 소스 단위로 원자 교체되고
    (`apply_extraction`), 한 엣지의 현재 값은 그것을 마지막으로 주장한 하나의 소스에서
    온다. 여러 소스가 같은 엣지를 주장한 이력은 그래프가 아니라 `graph_events`에 남는다.
    """

    id: GraphId
    kind: RelationName
    source_entity_id: GraphId
    target_entity_id: GraphId
    confidence: Confidence
    tier: SourceTier
    rationale: DerivedText | None = None
    source_id: GraphId
    attributes: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime
    extracted_at: datetime

    @model_validator(mode="after")
    def validate_relation(self) -> Self:
        if self.source_entity_id == self.target_entity_id:
            raise ValueError("relation endpoints must differ")
        if self.extracted_at < self.observed_at:
            raise ValueError("extracted_at must not precede observed_at")
        if self.id != relation_id(self.kind, self.source_entity_id, self.target_entity_id):
            raise ValueError("relation id must be derived from (kind, source, target)")
        return self


class GraphEvent(StrictGraphModel):
    """append-only 변경 기록 한 줄.

    Claim을 없애면서 그래프에서 사라진 시간축이 여기로 옮겨왔다. 그래프는 "지금 어떤
    상태인가"만 답하고, "언제 무엇이 바뀌었나"는 이 로그가 답한다. 원본에서 그래프를
    다시 지어도 과거의 그래프가 그대로 재현되지는 않으므로(프롬프트·dedup 규칙·LLM
    비결정성이 그 사이에 바뀐다), 이 로그가 *실제로 그렇게 됐었다*는 유일한 기록이다.
    """

    seq: Annotated[int, Field(strict=True, ge=1)]
    at: datetime
    revision: Annotated[int, Field(strict=True, ge=1)]
    op: GraphEventOp
    subject_id: GraphId
    object_id: GraphId | None = None
    relation: RelationName | None = None
    confidence_before: Confidence | None = None
    confidence_after: Confidence | None = None
    source_id: GraphId | None = None

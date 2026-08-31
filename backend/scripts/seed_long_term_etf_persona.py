"""장기·ETF·중대형주 투자자 페르소나의 성향 그래프를 결정적으로 씨앗한다.

그래프 모드 전수 검증(요약 표 · 군집 지도 · 군집 펼침 · 노드 선택 · 공통 패널 ·
필터 · 수집·노출)은 **충분한 대화 이력**이 있어야 의미가 있다. 노드 세 개짜리
그래프에서는 군집도 숨은 연관도 티어 대조도 화면에 나타날 수가 없어, 기능이
"동작한다"와 "그릴 게 없다"가 구분되지 않는다.

**왜 LLM 추출을 안 쓰나.** `probe-conversation-graph-e2e.js`는 실제 Claude CLI로
추출한다 — 진짜 파이프라인을 증명하는 값진 프로브지만, 매번 다른 그래프가 나오고
느리고 CLI 인증이 필요하다. 화면 기능 전수 검증에는 **같은 입력이면 같은 그래프**가
필요하다. 그래서 여기서는 추출 결과를 직접 넣는다 — 추출기를 건너뛰는 것이지
저장층을 건너뛰는 것이 아니다: `upsert_source` + `apply_extraction`이라는 실제
적재 경로를 그대로 쓰므로 리비전·이벤트 로그·티어 우선순위 규칙이 전부 진짜로 돈다.

**보강 횟수가 진짜인 이유.** `reinforcement`는 `graph_events`를 세는 값이고,
같은 (관계, 대상)을 **다른 소스**가 다시 주장할 때만 이벤트가 쌓인다
(`_apply_one_relation`). 그래서 여기서도 한 대화가 여러 관계를 조금씩 반복해
주장하는, 실제 대화 이력과 같은 모양으로 넣는다 — 숫자를 손으로 적어 넣지 않는다.

실행:
    python -m scripts.seed_long_term_etf_persona --db <경로> [--now <ISO8601>]
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from athena_api.brain.ontology import (  # noqa: E402
    Confidence,
    Entity,
    EntityKind,
    RelationKind,
    Relation,
    SourceKind,
    SourceRecord,
    SourceTier,
    entity_id,
    relation_id,
)
from athena_api.brain.store import (  # noqa: E402
    INVESTOR_PROFILE_ENTITY_ID,
    INVESTOR_PROFILE_NAME,
    GraphStore,
)

# ── 엔티티 카탈로그 ──────────────────────────────────────────────────────────
#
# 장기·ETF·중대형주 성향이 실제로 만들 법한 폭이다: 지수·배당 ETF가 뼈대이고,
# 중대형주는 테마별로 몇 종목씩, 거시 변수는 따로 논다. 군집이 저절로 갈리도록
# 종목↔테마 `belongs_to`를 촘촘히 걸고 테마끼리는 거의 안 잇는다.

SECURITIES = {
    # 지수·배당 ETF — 이 사람의 핵심 자산
    "TIGER 미국S&P500": ["미국 지수 ETF"],
    "TIGER 미국나스닥100": ["미국 지수 ETF"],
    "ACE 미국배당다우존스": ["미국 지수 ETF", "배당·인컴"],
    "KODEX 200": ["국내 지수 ETF"],
    "KODEX 배당가치": ["국내 지수 ETF", "배당·인컴"],
    "TIGER 리츠부동산인프라": ["배당·인컴"],
    "KODEX 반도체": ["국내 지수 ETF", "반도체 대형주"],
    # 반도체 대형주
    "삼성전자": ["반도체 대형주"],
    "SK하이닉스": ["반도체 대형주"],
    "한미반도체": ["반도체 대형주"],
    "DB하이텍": ["반도체 대형주"],
    # 금융·지주 (배당 성향의 국내 축)
    "KB금융": ["금융·지주", "배당·인컴"],
    "신한지주": ["금융·지주", "배당·인컴"],
    "삼성화재": ["금융·지주", "배당·인컴"],
    # 산업 대형주
    "현대차": ["자동차·산업"],
    "기아": ["자동차·산업"],
    "HD현대일렉트릭": ["자동차·산업"],
    "POSCO홀딩스": ["자동차·산업"],
    # 성장 대형주
    "NAVER": ["인터넷·플랫폼"],
    "카카오": ["인터넷·플랫폼"],
    "삼성바이오로직스": ["헬스케어"],
    "셀트리온": ["헬스케어"],
}

THEMES = [
    "미국 지수 ETF",
    "국내 지수 ETF",
    "배당·인컴",
    "반도체 대형주",
    "금융·지주",
    "자동차·산업",
    "인터넷·플랫폼",
    "헬스케어",
]

MACRO = ["금리 인하", "원/달러 환율", "미국 CPI"]

PREFERENCES = [
    "장기 보유",
    "배당 재투자",
    "분산 투자",
    "환헤지 미적용",
]

AVOIDED = ["단기 테마주", "레버리지 ETF"]

GOALS = ["10년 뒤 배당 현금흐름"]


def _entity(kind: EntityKind, name: str, created: datetime) -> Entity:
    return Entity(
        id=entity_id(kind, name),
        kind=kind,
        name=name,
        created_at=created,
        updated_at=created,
    )


def build_entities(created: datetime) -> dict[str, Entity]:
    """이름 → Entity. 투자자 프로필도 같은 사전에 둔다(관계 끝점이라 필요하다)."""
    catalog: dict[str, Entity] = {
        INVESTOR_PROFILE_NAME: Entity(
            id=INVESTOR_PROFILE_ENTITY_ID,
            kind=EntityKind.INVESTOR_PROFILE,
            name=INVESTOR_PROFILE_NAME,
            created_at=created,
            updated_at=created,
        )
    }
    for name in SECURITIES:
        catalog[name] = _entity(EntityKind.SECURITY, name, created)
    for name in THEMES:
        catalog[name] = _entity(EntityKind.THEME, name, created)
    for name in MACRO:
        catalog[name] = _entity(EntityKind.RISK_SIGNAL, name, created)
    for name in PREFERENCES + AVOIDED:
        catalog[name] = _entity(EntityKind.PREFERENCE, name, created)
    for name in GOALS:
        catalog[name] = _entity(EntityKind.GOAL, name, created)
    return catalog


# ── 대화·체결 이력 ───────────────────────────────────────────────────────────
#
# (며칠 전, 소스 종류, 본문, [(관계, 대상, confidence, 근거)]) — 실제 이력처럼
# 같은 주장이 여러 날에 걸쳐 반복된다. 그 반복이 `reinforcement`가 된다.

Claim = tuple[str, str, Confidence, str | None]


def conversation_history() -> list[tuple[int, SourceKind, str, list[Claim]]]:
    """130일치 이력. 앞쪽(숫자가 큰 것)이 오래된 대화다."""
    talk = SourceKind.CHAT_MESSAGE
    fill = SourceKind.TRADE
    balance = SourceKind.HOLDING
    E = Confidence.EXTRACTED
    I = Confidence.INFERRED
    A = Confidence.AMBIGUOUS

    history: list[tuple[int, SourceKind, str, list[Claim]]] = [
        (128, talk, "은퇴까지 10년 넘게 남았고 매달 넣을 생각이라 지수 ETF부터 깔고 가려 합니다.", [
            (RelationKind.PREFERS, "장기 보유", I, "6개 대화에서 \"10년은 들고 간다\""),
            (RelationKind.TARGETS, "10년 뒤 배당 현금흐름", I, "은퇴 시점 현금흐름 목표를 반복 언급"),
            (RelationKind.INTERESTED_IN, "미국 지수 ETF", I, "적립식 매수 대상으로 먼저 검토"),
        ]),
        (124, talk, "TIGER 미국S&P500과 나스닥100 중에 뭐가 장기적으로 안정적일까요?", [
            (RelationKind.RESEARCHED, "TIGER 미국S&P500", E, "지수 구성·보수 비교 질문"),
            (RelationKind.RESEARCHED, "TIGER 미국나스닥100", E, "지수 구성·보수 비교 질문"),
            (RelationKind.INTERESTED_IN, "미국 지수 ETF", I, "두 상품을 나란히 비교"),
        ]),
        (120, fill, "TIGER 미국S&P500 40주 매수 체결", [
            (RelationKind.OWNS, "TIGER 미국S&P500", E, "체결 3건 · 평균 18,240원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "TIGER 미국S&P500", E, "적립식 매수 체결"),
        ]),
        (116, talk, "배당을 다시 넣어서 굴리는 쪽이 좋겠어요. 현금으로 빼면 결국 써버려서.", [
            (RelationKind.PREFERS, "배당 재투자", I, "\"현금으로 빼면 써버린다\" 반복"),
            (RelationKind.INTERESTED_IN, "배당·인컴", I, "배당 재투자 맥락에서 언급"),
        ]),
        (112, talk, "한 종목에 몰빵하는 건 무서워요. 최소 열 종목 이상 나눠 담고 싶어요.", [
            (RelationKind.PREFERS, "분산 투자", I, "\"열 종목 이상\" 기준을 스스로 제시"),
            (RelationKind.AVOIDS, "단기 테마주", I, "\"테마 붙으면 이미 늦다\""),
        ]),
        (108, fill, "삼성전자 60주 매수 체결", [
            (RelationKind.OWNS, "삼성전자", E, "체결 6건 · 평균 71,200원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "삼성전자", E, "분할 매수 체결"),
            (RelationKind.EXPOSED_TO, "반도체 대형주", E, "보유 비중 기준 최대 테마"),
        ]),
        (104, talk, "삼성전자는 사이클 저점이라고 보는데 HBM은 하이닉스가 앞서 있죠?", [
            (RelationKind.INTERESTED_IN, "SK하이닉스", I, "HBM 경쟁력 질문 5회"),
            (RelationKind.RESEARCHED, "SK하이닉스", E, "HBM 점유율·capex 조회"),
            (RelationKind.INTERESTED_IN, "반도체 대형주", I, "사이클 저점 논의"),
        ]),
        (100, balance, "계좌 잔고 스냅샷", [
            (RelationKind.OWNS, "KODEX 200", E, "잔고 120주 · 평균 34,050원"),
            (RelationKind.OWNS, "KB금융", E, "잔고 90주 · 평균 62,400원"),
        ]),
        (96, talk, "배당주는 은행이 제일 편한 것 같아요. KB랑 신한 둘 다 볼까요?", [
            (RelationKind.INTERESTED_IN, "금융·지주", I, "\"배당은 은행이 편하다\""),
            (RelationKind.RESEARCHED, "KB금융", E, "배당수익률·배당성향 조회"),
            (RelationKind.RESEARCHED, "신한지주", E, "배당수익률·배당성향 조회"),
            (RelationKind.PREFERS, "배당 재투자", I, "배당 성장 관점에서 재확인"),
        ]),
        (92, fill, "삼성전자 20주 추가 매수 체결", [
            (RelationKind.OWNS, "삼성전자", E, "체결 8건 · 평균 70,850원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "삼성전자", E, "추가 분할 매수"),
        ]),
        (88, talk, "금리 내려가면 리츠가 먼저 반응한다던데 맞나요?", [
            (RelationKind.INTERESTED_IN, "TIGER 리츠부동산인프라", I, "금리 인하 수혜 질문"),
            (RelationKind.EXPOSED_TO, "금리 인하", I, "리츠·배당주 문맥에서 3회 등장"),
            (RelationKind.INTERESTED_IN, "배당·인컴", I, "리츠를 인컴 자산으로 분류"),
        ]),
        (84, talk, "환율이 1,400원인데 지금 미국 ETF 더 사도 될까요? 환헤지는 안 하고 있어요.", [
            (RelationKind.EXPOSED_TO, "원/달러 환율", E, "미국 ETF 비중 62% · 환헤지 미적용"),
            (RelationKind.PREFERS, "환헤지 미적용", A, "\"장기라 환은 평균회귀\" — 근거는 직관"),
            (RelationKind.RESEARCHED, "TIGER 미국S&P500", E, "환노출 영향 조회"),
        ]),
        (80, fill, "TIGER 미국S&P500 25주 매수 체결", [
            (RelationKind.OWNS, "TIGER 미국S&P500", E, "체결 6건 · 평균 18,510원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "TIGER 미국S&P500", E, "적립식 매수 체결"),
        ]),
        (76, talk, "레버리지 ETF는 장기로 들고 가면 안 된다고 들었어요.", [
            (RelationKind.AVOIDS, "레버리지 ETF", E, "\"장기 보유 시 변동성 잠식\"을 직접 언급"),
            (RelationKind.PREFERS, "장기 보유", I, "레버리지 회피 근거로 장기 관점 재확인"),
        ]),
        (72, talk, "현대차 배당이 생각보다 높네요. 자동차도 배당주로 볼 수 있나요?", [
            (RelationKind.RESEARCHED, "현대차", E, "배당수익률·주주환원 조회"),
            (RelationKind.INTERESTED_IN, "자동차·산업", I, "주주환원 관점에서 편입 검토"),
            (RelationKind.PREFERS, "배당 재투자", I, "자동차까지 배당 관점으로 확장"),
        ]),
        (68, fill, "현대차 30주 매수 체결", [
            (RelationKind.OWNS, "현대차", E, "체결 2건 · 평균 241,000원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "현대차", E, "신규 편입 체결"),
        ]),
        (64, talk, "네이버랑 카카오는 계속 빠지는데 지금이 기회일까요?", [
            (RelationKind.RESEARCHED, "NAVER", E, "밸류에이션·영업이익 추이 조회"),
            (RelationKind.RESEARCHED, "카카오", E, "밸류에이션·영업이익 추이 조회"),
            (RelationKind.INTERESTED_IN, "인터넷·플랫폼", A, "\"기회일까요\" — 편입 의사는 불명확"),
        ]),
        (60, talk, "그래도 저는 오래 들고 가는 게 맞다고 봐요. 10년은 안 팔 생각입니다.", [
            (RelationKind.PREFERS, "장기 보유", I, "6개 대화에서 \"10년은 들고 간다\""),
            (RelationKind.TARGETS, "10년 뒤 배당 현금흐름", I, "목표 시점을 다시 못박음"),
        ]),
        (56, fill, "SK하이닉스 15주 매수 후 8일 만에 전량 매도", [
            # 말과 행동이 어긋나는 지점 — 화면의 "두 출처가 다르게 말합니다"가 이것이다.
            (RelationKind.TRADED, "장기 보유", E, "체결 34건 · 평균 보유 18일 · 최장 62일"),
            (RelationKind.TRADED, "SK하이닉스", E, "매수 8일 후 전량 매도"),
            (RelationKind.OWNS, "SK하이닉스", E, "잔고 0주 — 보유 종료"),
        ]),
        (52, talk, "제가 좀 자주 사고파는 편인가요? 스스로는 장기라고 생각했는데.", [
            (RelationKind.PREFERS, "장기 보유", A, "본인도 어긋남을 인지 — 확인 필요"),
            (RelationKind.INTERESTED_IN, "반도체 대형주", I, "회전 사유를 반도체 사이클로 설명"),
        ]),
        (48, balance, "계좌 잔고 스냅샷", [
            (RelationKind.OWNS, "ACE 미국배당다우존스", E, "잔고 80주 · 평균 11,900원"),
            (RelationKind.OWNS, "KODEX 배당가치", E, "잔고 150주 · 평균 9,850원"),
            (RelationKind.EXPOSED_TO, "배당·인컴", E, "배당형 자산 비중 31%"),
        ]),
        (44, talk, "미국 배당 ETF는 SCHD 추종이 국내에도 있죠? 그걸로 모으고 싶어요.", [
            (RelationKind.RESEARCHED, "ACE 미국배당다우존스", E, "SCHD 추종 여부·보수 조회"),
            (RelationKind.PREFERS, "배당 재투자", I, "배당 ETF 적립을 재확인"),
            (RelationKind.INTERESTED_IN, "미국 지수 ETF", I, "배당형까지 미국 축으로 확장"),
        ]),
        (40, talk, "CPI 발표 때마다 흔들리는데 그냥 무시하고 모아도 될까요?", [
            (RelationKind.EXPOSED_TO, "미국 CPI", I, "발표일마다 문의 4회"),
            (RelationKind.PREFERS, "장기 보유", I, "\"무시하고 모은다\"로 장기 관점 재확인"),
        ]),
        (36, fill, "KODEX 배당가치 100주 매수 체결", [
            (RelationKind.OWNS, "KODEX 배당가치", E, "체결 4건 · 평균 9,910원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "KODEX 배당가치", E, "적립식 매수 체결"),
        ]),
        (32, talk, "삼성화재도 배당이 좋다고 하던데 은행이랑 겹치지 않을까요?", [
            (RelationKind.RESEARCHED, "삼성화재", E, "배당성향·자본비율 조회"),
            (RelationKind.INTERESTED_IN, "금융·지주", I, "은행+보험 중복 노출을 스스로 점검"),
            (RelationKind.PREFERS, "분산 투자", I, "중복 노출 우려로 분산 원칙 재확인"),
        ]),
        (28, talk, "포스코홀딩스랑 HD현대일렉트릭은 성격이 많이 다른가요?", [
            (RelationKind.RESEARCHED, "POSCO홀딩스", E, "전방 산업·사이클 조회"),
            (RelationKind.RESEARCHED, "HD현대일렉트릭", E, "전력기기 수주 추이 조회"),
            (RelationKind.INTERESTED_IN, "자동차·산업", I, "산업재 축을 넓혀 검토"),
        ]),
        (24, fill, "KB금융 40주 추가 매수 체결", [
            (RelationKind.OWNS, "KB금융", E, "체결 5건 · 평균 63,100원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "KB금융", E, "배당락 전 추가 매수"),
            (RelationKind.EXPOSED_TO, "배당·인컴", E, "배당형 자산 비중 34%"),
        ]),
        (20, talk, "바이오는 잘 모르겠어요. 삼성바이오랑 셀트리온만 이름은 아는 정도.", [
            (RelationKind.RESEARCHED, "삼성바이오로직스", E, "사업 구조 개요 조회"),
            (RelationKind.RESEARCHED, "셀트리온", E, "사업 구조 개요 조회"),
            (RelationKind.INTERESTED_IN, "헬스케어", A, "\"잘 모르겠다\" — 관심 여부 불명확"),
        ]),
        (16, talk, "한미반도체는 HBM 장비주라던데 반도체 ETF에 들어가 있나요?", [
            (RelationKind.RESEARCHED, "한미반도체", E, "HBM 장비 질문 4회"),
            (RelationKind.INTERESTED_IN, "한미반도체", I, "HBM 장비 질문 4회"),
            (RelationKind.RESEARCHED, "KODEX 반도체", E, "구성종목 편입 여부 조회"),
        ]),
        (12, fill, "TIGER 리츠부동산인프라 200주 매수 체결", [
            (RelationKind.OWNS, "TIGER 리츠부동산인프라", E, "체결 3건 · 평균 4,780원 · 계좌 잔고와 일치"),
            (RelationKind.TRADED, "TIGER 리츠부동산인프라", E, "금리 인하 기대 반영 매수"),
            (RelationKind.EXPOSED_TO, "금리 인하", E, "리츠 비중 9%로 확대"),
        ]),
        (8, talk, "결국 저는 지수 ETF 반, 배당 자산 반으로 가는 게 마음이 편해요.", [
            (RelationKind.PREFERS, "분산 투자", I, "자산군 5:5 배분을 스스로 규칙화"),
            (RelationKind.PREFERS, "배당 재투자", I, "배당 축을 절반으로 못박음"),
            (RelationKind.TARGETS, "10년 뒤 배당 현금흐름", I, "5:5 배분의 목적으로 재확인"),
        ]),
        (4, talk, "DB하이텍 같은 중소형은 안 볼래요. 대형주만 담을게요.", [
            (RelationKind.RESEARCHED, "DB하이텍", E, "시총·거래대금 조회 후 제외"),
            (RelationKind.AVOIDS, "단기 테마주", E, "\"대형주만 담겠다\"고 직접 선언"),
            (RelationKind.PREFERS, "분산 투자", I, "대형주 한정으로 분산 규칙을 좁힘"),
        ]),
        (1, talk, "기아도 배당이 괜찮던데 현대차랑 같이 담으면 중복인가요?", [
            (RelationKind.RESEARCHED, "기아", E, "배당·밸류에이션 조회"),
            (RelationKind.PREFERS, "분산 투자", I, "동일 산업 중복을 스스로 점검"),
            (RelationKind.INTERESTED_IN, "자동차·산업", I, "완성차 2종목 동시 검토"),
        ]),
    ]
    return history


def structural_claims() -> list[tuple[str, str, str]]:
    """종목 → 테마 `belongs_to`. 군집이 갈리는 뼈대다.

    투자자 프로필에서 뻗은 관계가 아니라 엔티티끼리의 관계라 요약 표에는 안 뜨고,
    군집 지도에만 나타난다 — 그것이 "요약은 성향, 지도는 구조"라는 두 화면의 분업이다.
    """
    claims: list[tuple[str, str, str]] = []
    for security, themes in SECURITIES.items():
        for theme in themes:
            claims.append((security, RelationKind.BELONGS_TO, theme))
    # 거시 변수는 테마 경계를 넘는다 — 이것이 "숨은 연관"의 재료다. 사용자가 직접
    # 말한 적 없는 연결이라 confidence도 INFERRED로 둔다.
    claims += [
        ("TIGER 리츠부동산인프라", RelationKind.EXPOSED_TO, "금리 인하"),
        ("KB금융", RelationKind.EXPOSED_TO, "금리 인하"),
        ("SK하이닉스", RelationKind.EXPOSED_TO, "원/달러 환율"),
        ("TIGER 미국S&P500", RelationKind.EXPOSED_TO, "원/달러 환율"),
        ("TIGER 미국나스닥100", RelationKind.EXPOSED_TO, "미국 CPI"),
        ("한미반도체", RelationKind.RELATES_TO, "배당·인컴"),
    ]
    return claims


def _source_for(index: int, kind: SourceKind, text: str, occurred: datetime) -> SourceRecord:
    fingerprint = hashlib.sha256(f"{index}\0{text}".encode()).hexdigest()
    return SourceRecord(
        id=f"src-persona-{index:03d}",
        kind=kind,
        text=text,
        locator=f"seed:{index:03d}",
        fingerprint=fingerprint,
        occurred_at=occurred,
        ingested_at=occurred,
    )


def _tier_for(kind: SourceKind) -> SourceTier:
    return (
        SourceTier.CONVERSATIONAL
        if kind is SourceKind.CHAT_MESSAGE
        else SourceTier.DETERMINISTIC
    )


async def seed(db_path: Path, now: datetime) -> dict[str, int]:
    catalog = build_entities(now - timedelta(days=140))
    store = GraphStore(db_path)
    await store.open()
    try:
        applied_relations = 0
        history = conversation_history()

        for index, (days_ago, kind, text, claims) in enumerate(history):
            occurred = now - timedelta(days=days_ago)
            source = _source_for(index, kind, text, occurred)
            await store.upsert_source(source)
            tier = _tier_for(kind)

            used: dict[str, Entity] = {INVESTOR_PROFILE_NAME: catalog[INVESTOR_PROFILE_NAME]}
            relations: list[Relation] = []
            for relation_kind, target_name, confidence, rationale in claims:
                target = catalog[target_name]
                used[target_name] = target
                relations.append(
                    Relation(
                        id=relation_id(
                            str(relation_kind), INVESTOR_PROFILE_ENTITY_ID, target.id
                        ),
                        kind=str(relation_kind),
                        source_entity_id=INVESTOR_PROFILE_ENTITY_ID,
                        target_entity_id=target.id,
                        confidence=confidence,
                        tier=tier,
                        rationale=rationale,
                        source_id=source.id,
                        observed_at=occurred,
                        extracted_at=occurred,
                    )
                )
            await store.apply_extraction(
                source.id,
                source.fingerprint,
                tuple(used.values()),
                tuple(relations),
            )
            applied_relations += len(relations)

        # 구조 관계는 마지막 한 소스가 통째로 소유한다 — 대화마다 흩어 두면 한
        # 대화를 다시 적재할 때 그래프 뼈대가 통째로 흔들린다.
        structure_source = _source_for(
            len(history), SourceKind.CONVERSATION, "종목·테마 구조 관계", now - timedelta(days=2)
        )
        await store.upsert_source(structure_source)
        used = {}
        structure_relations: list[Relation] = []
        for subject_name, relation_kind, object_name in structural_claims():
            subject = catalog[subject_name]
            obj = catalog[object_name]
            used[subject_name] = subject
            used[object_name] = obj
            structure_relations.append(
                Relation(
                    id=relation_id(str(relation_kind), subject.id, obj.id),
                    kind=str(relation_kind),
                    source_entity_id=subject.id,
                    target_entity_id=obj.id,
                    confidence=Confidence.INFERRED,
                    # 구조 관계는 대화에서 유도된 것이라 대화 티어다 — 체결·잔고가
                    # 주장한 엣지를 덮지 못한다는 우선순위 규칙 안에 그대로 둔다.
                    tier=SourceTier.CONVERSATIONAL,
                    rationale=None,
                    source_id=structure_source.id,
                    observed_at=now - timedelta(days=2),
                    extracted_at=now - timedelta(days=2),
                )
            )
        await store.apply_extraction(
            structure_source.id,
            structure_source.fingerprint,
            tuple(used.values()),
            tuple(structure_relations),
        )

        summary = await store.summary()
        entries = await store.investor_profile_summary(now=now, window_days=90, limit=500)
        total = await store.investor_profile_signal_count(now=now, window_days=90)
        return {
            "entities": summary.entities,
            "relations": summary.relations,
            "revision": summary.revision,
            "profile_entries_90d": len(entries),
            "profile_total_90d": total,
            "sources": len(history) + 1,
            "applied_relations": applied_relations + len(structure_relations),
            "max_reinforcement": max((e.reinforcement for e in entries), default=0),
        }
    finally:
        await store.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="브레인 SQLite 경로")
    parser.add_argument(
        "--now",
        default=None,
        help="기준 시각(ISO-8601, UTC). 생략하면 현재 시각 — 결정적 재현이 필요하면 고정한다.",
    )
    args = parser.parse_args()
    now = (
        datetime.fromisoformat(args.now).astimezone(UTC)
        if args.now
        else datetime.now(UTC)
    )
    stats = asyncio.run(seed(Path(args.db), now))
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

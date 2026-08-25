"""검증 3층 중 **판정자 층** — 실제 모델을 태워 추출 품질을 사람이 본다.

leaf 9(2026-08-25). 앞의 두 층과 성격이 다르다.

| 층 | 무엇을 재나 | 언제 도나 |
|---|---|---|
| 결정층 (`pytest -m deterministic`) | 저장층 계약·결정적 티어 | CI 매번 |
| 녹화응답층 (`pytest -m replay`) | 추출 전 경로, LLM 없이 | CI 매번 |
| **판정자 층 (이 스크립트)** | 뽑힌 것이 **맞는가** | 사람이 손으로 |

**왜 자동화하지 않나.** "삼성전자를 좋아한다"를 뽑았는지는 코드가 잴 수 있지만, 그게
*맞는 판단인지*는 잴 수 없다. 정답표를 만들어 두면 그 표가 곧 프롬프트의 사양이 되고,
표에 없는 좋은 추출이 실패로 잡힌다. 그래서 이 층은 **점수가 아니라 대조표**를 낸다 —
사람이 읽고 프롬프트를 고칠지 정한다.

돈과 시간도 이유다. CI가 매 커밋마다 실제 모델을 태우면 비용이 선형으로 늘고,
LLM은 결정적이지 않아 같은 입력에 다른 답이 나온다 — 빨간 CI의 원인이 코드인지 모델인지
구분할 수 없게 된다.

사용법:

    # 사용법만 보기(API 키·CLI 불필요)
    python scripts/evaluate_brain_extraction.py --help

    # 녹화 코퍼스를 실제 `claude` CLI로 다시 뽑아 대조
    python scripts/evaluate_brain_extraction.py --corpus <recordings.json 경로>

    # 임의 대화 파일 하나
    python scripts/evaluate_brain_extraction.py --text "삼성전자 계속 들고 갈 생각이야"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))


def _force_utf8_console() -> None:
    """Windows 콘솔이 한글·em-dash를 못 내는 것을 막는다.

    기본 코드페이지가 cp949라 `--help`조차 `UnicodeEncodeError`로 죽었다(실측).
    이 리포는 Windows Electron 앱을 배포하므로 "리눅스에서는 되던데"는 답이 아니다.
    `errors="replace"`까지 붙이는 이유: 인코딩을 못 바꾸는 환경에서도 보고서가 나와야
    한다 — 글자 몇 개가 물음표로 나오는 것이 아무것도 안 나오는 것보다 낫다.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_force_utf8_console()

DEFAULT_CORPUS = REPO_BACKEND / "tests" / "fixtures" / "brain_extraction" / "recordings.json"


def _build_parser() -> argparse.ArgumentParser:
    """`--help`가 무거운 import 없이 동작해야 한다.

    브레인 모듈을 최상단에서 import하면 사용법을 보려는 사람도 pydantic·networkx를
    전부 로드하게 되고, 의존성이 하나라도 어긋난 환경에서는 `--help`조차 실패한다.
    """
    parser = argparse.ArgumentParser(
        prog="evaluate_brain_extraction",
        description=(
            "실제 LLM으로 추출을 돌려 사람이 읽을 대조표를 낸다. "
            "점수를 매기지 않는다 — 정답표를 두면 그 표가 곧 프롬프트의 사양이 되고, "
            "표에 없는 좋은 추출이 실패로 잡힌다."
        ),
        epilog="CI에서 돌리지 마라. 결정층·녹화응답층이 CI의 몫이다.",
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--corpus",
        type=Path,
        help=f"대화 코퍼스 JSON. 기본: {DEFAULT_CORPUS.relative_to(REPO_BACKEND)}",
    )
    source.add_argument("--text", help="대화 한 건을 직접 넘긴다.")
    parser.add_argument(
        "--claude",
        default="claude",
        help="실행할 CLI. 기본 'claude' — PATH에서 찾는다.",
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="코퍼스에서 앞의 N건만. 0이면 전부."
    )
    parser.add_argument(
        "--json", action="store_true", help="대조표 대신 JSON으로 낸다(다른 도구에 물릴 때)."
    )
    parser.add_argument(
        "--show-prompt",
        action="store_true",
        help="조립된 프롬프트를 함께 출력한다. 프롬프트를 고칠 때 쓴다.",
    )
    return parser


def _load_conversations(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.text:
        return [
            {
                "name": "직접 입력",
                "source": {
                    "id": "conversation:adhoc",
                    "kind": "conversation",
                    "text": args.text if args.text.endswith("\n") else args.text + "\n",
                    "occurred_at": datetime.now(tz=UTC).isoformat(),
                },
            }
        ]
    path = args.corpus or DEFAULT_CORPUS
    items = json.loads(Path(path).read_text(encoding="utf-8"))
    if args.limit > 0:
        items = items[: args.limit]
    return items


async def _evaluate(args: argparse.Namespace) -> int:
    # 무거운 import는 여기서. 위 `_build_parser` 주석 참고.
    from athena_api.brain import (  # noqa: PLC0415
        ClaudeCliStructuredLlm,
        ExtractionError,
        ExtractionService,
        GraphStore,
        SourceKind,
        SourceRecord,
    )

    conversations = _load_conversations(args)
    if not conversations:
        print("코퍼스가 비어 있다.", file=sys.stderr)
        return 2

    client = ClaudeCliStructuredLlm(claude_argv=(args.claude,))
    rows: list[dict[str, Any]] = []

    import tempfile  # noqa: PLC0415

    with tempfile.TemporaryDirectory() as workdir:
        graph = GraphStore(Path(workdir) / "evaluation.sqlite3")
        await graph.open()
        try:
            for index, item in enumerate(conversations):
                spec = item["source"]
                record = SourceRecord(
                    id=f"{spec['id']}#{index}",
                    kind=SourceKind(spec.get("kind", "conversation")),
                    text=spec["text"],
                    fingerprint=f"eval-{index}",
                    occurred_at=datetime.fromisoformat(spec["occurred_at"]),
                    ingested_at=datetime.now(tz=UTC),
                )
                await graph.upsert_source(record)
                before = await graph.summary()
                error: str | None = None
                try:
                    await ExtractionService(client, graph).project_source(record)
                except ExtractionError as exc:
                    error = str(exc)
                after = await graph.summary()

                relations = [
                    relation
                    for relation in await graph.relations()
                    if relation.source_id == record.id
                ]
                rows.append(
                    {
                        "name": item.get("name", record.id),
                        "text": spec["text"].strip(),
                        "error": error,
                        "entities_added": after.entities - before.entities,
                        "relations": [
                            {
                                "kind": relation.kind,
                                "confidence": relation.confidence,
                                "tier": relation.tier,
                                "rationale": relation.rationale,
                            }
                            for relation in relations
                        ],
                    }
                )
        finally:
            await graph.close()

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    _print_table(rows)
    # 실패가 있어도 0으로 끝낸다. 이건 게이트가 아니라 사람이 읽는 보고서다 —
    # 종료코드로 판단을 흉내 내면 누군가 이걸 CI에 넣는다.
    return 0


def _print_table(rows: list[dict[str, Any]]) -> None:
    print("=" * 78)
    print("추출 대조표 — 점수가 아니라 사람이 읽는 표다")
    print("=" * 78)
    for row in rows:
        print()
        print(f"[{row['name']}]")
        print(f"  대화: {row['text'][:120]}")
        if row["error"]:
            print(f"  !! 추출 실패: {row['error']}")
            continue
        print(f"  엔티티 +{row['entities_added']}")
        if not row["relations"]:
            print("  관계: (없음) — 뽑을 성향이 없었는지, 프롬프트가 놓쳤는지 사람이 본다")
        for relation in row["relations"]:
            rationale = relation["rationale"] or "-"
            print(
                f"  · {relation['kind']:<14} {relation['confidence']:<10}"
                f" {relation['tier']:<14} 이유: {rationale}"
            )
    print()
    print("-" * 78)
    print(
        "AMBIGUOUS가 하나도 없으면 의심하라 — 실제 대화에는 애매한 말이 섞인다. "
        "전부 EXTRACTED면 모델이 확신을 지어내고 있을 수 있다."
    )


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    return asyncio.run(_evaluate(args))


if __name__ == "__main__":
    raise SystemExit(main())

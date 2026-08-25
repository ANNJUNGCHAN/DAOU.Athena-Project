"""그래프 분석 비용과 지표 중복도를 잰다.

`analysis.py`의 `god_nodes`가 매개 중심성을 **쓰지 않는** 근거가 여기서 나온다.
그 주석이 인용하는 수치는 이 스크립트로 재생산할 수 있어야 한다 — 그러지 못하면
"측정하지 않은 것은 주장하지 않는다"를 코드가 스스로 어기는 것이다.

원래 이 수치는 일회성 REPL 측정이었고, 합의 검토에서 "제3자가 재현할 수 없다"는
지적을 받아 파일로 남겼다.

두 가지를 잰다.

1. **비용** — `betweenness_centrality`와 `greedy_modularity_communities`의 실행 시간.
2. **중복도** — 차수 상위 10개와 매개 상위 10개가 얼마나 겹치는가.

(2)가 결정적이다. 매개가 비싸도 차수가 못 보는 것을 본다면 값을 한다. 실측에서는
겹침이 9~10/10이라 값을 하지 못했다.

**왜 Barabási–Albert인가.** 투자 성향 그래프는 척도 없는 형태에 가깝다 — 소수의 종목·
테마에 관계가 몰리고 대부분은 차수가 낮다. 균등 무작위 그래프(Erdős–Rényi)로 재면
허브가 없어 두 지표의 차이가 실제보다 크게 나온다.

절대 시간은 하드웨어를 탄다. **재현되어야 하는 것은 겹침 비율**이다.

사용법:

    python scripts/bench_graph_analysis.py             # 기본 크기들
    python scripts/bench_graph_analysis.py --sizes 200 1000
    python scripts/bench_graph_analysis.py --json      # 기계가 읽을 형태
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

# 한글·em-dash가 cp949 콘솔에서 죽는 것을 막는다(Windows 기본 코드페이지).
# `evaluate_brain_extraction.py`와 같은 이유.
for _stream in (sys.stdout, sys.stderr):
    _reconfigure = getattr(_stream, "reconfigure", None)
    if _reconfigure is not None:
        try:
            _reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

DEFAULT_SIZES = (200, 600, 1500)
SEED = 11
ATTACHMENT = 3
TOP_N = 10


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bench_graph_analysis",
        description=(
            "매개 중심성의 비용과, 그것이 차수 대비 실제로 다른 순위를 내는지를 잰다. "
            "god_nodes가 매개를 쓰지 않는 근거다."
        ),
        epilog="절대 시간은 하드웨어를 탄다. 재현되어야 하는 것은 상위10 겹침 비율이다.",
    )
    parser.add_argument(
        "--sizes",
        type=int,
        nargs="+",
        default=list(DEFAULT_SIZES),
        help=f"잴 노드 수. 기본 {' '.join(map(str, DEFAULT_SIZES))}",
    )
    parser.add_argument("--json", action="store_true", help="표 대신 JSON으로 낸다.")
    parser.add_argument(
        "--seed", type=int, default=SEED, help=f"그래프 생성 시드. 기본 {SEED}"
    )
    return parser


def measure(size: int, *, seed: int) -> dict[str, Any]:
    # 무거운 import는 여기서 — `--help`가 networkx 없이도 동작해야 한다.
    import networkx as nx  # noqa: PLC0415

    graph = nx.barabasi_albert_graph(size, ATTACHMENT, seed=seed)

    start = time.perf_counter()
    betweenness = nx.betweenness_centrality(graph)
    betweenness_seconds = time.perf_counter() - start

    start = time.perf_counter()
    nx.community.greedy_modularity_communities(graph)
    clustering_seconds = time.perf_counter() - start

    by_degree = sorted(graph.nodes, key=lambda n: (-graph.degree(n), n))[:TOP_N]
    by_betweenness = sorted(graph.nodes, key=lambda n: (-betweenness[n], n))[:TOP_N]

    return {
        "nodes": size,
        "edges": graph.number_of_edges(),
        "betweenness_seconds": round(betweenness_seconds, 3),
        "clustering_seconds": round(clustering_seconds, 3),
        "top10_overlap": len(set(by_degree) & set(by_betweenness)),
        "top10_exact_position": sum(
            1 for i in range(TOP_N) if by_degree[i] == by_betweenness[i]
        ),
    }


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if any(size < TOP_N for size in args.sizes):
        print(f"노드 수는 {TOP_N} 이상이어야 상위10 비교가 의미를 갖는다.", file=sys.stderr)
        return 2

    rows = [measure(size, seed=args.seed) for size in sorted(args.sizes)]

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    print(f"{'노드':>7} {'엣지':>7} {'betweenness':>12} {'군집':>9} {'상위10 겹침':>12}")
    for row in rows:
        print(
            f"{row['nodes']:>7} {row['edges']:>7}"
            f" {row['betweenness_seconds']:>11.2f}s {row['clustering_seconds']:>8.2f}s"
            f" {row['top10_overlap']:>9}/10"
        )
    print()
    worst = min(row["top10_overlap"] for row in rows)
    print(f"최소 겹침 {worst}/10 — 매개가 차수와 다른 답을 내는 정도다.")
    if worst >= 9:
        print("9/10 이상이면 매개는 비용만큼의 값을 하지 못한다. god_nodes가 차수만 쓰는 근거.")
    else:
        print("겹침이 9/10 미만이다 — 매개를 다시 검토할 근거가 생겼다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

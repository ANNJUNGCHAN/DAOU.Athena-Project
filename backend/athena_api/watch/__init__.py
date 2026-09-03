"""코드 감시(code.watch) 실행층 — 루틴 패키지 밖에서 감시 함수를 돌린다.

`athena_api.routines`는 코드를 실행하지 않는다(소스 grep 테스트가 exec/compile 부재를
고정한다). 이 패키지가 백테스트 샌드박스(`backtest.sandbox.host.run_strategy`)를 빌려
감시 함수를 별도 프로세스에서 돌리고, 마지막 행 판정·검사(미니 백테스트)·노드 카드를
만든다. 루틴 런타임은 `WatchRunner`를 주입받을 뿐이다.

모드 격리(R5): 여기서는 백테스트의 전략·실행·배포 표를 만지지 않는다. 공유하는 것은
일봉 캐시(`bt_candle`/`bt_coverage`)뿐이다.
"""

from athena_api.watch.check import CheckResult, run_check
from athena_api.watch.data import FrameResult, assemble_frame, closed_frame, frame_from_candles
from athena_api.watch.nodes import NodeCard, build_nodes
from athena_api.watch.runner import RunResult, WatchRunner, trace_names_for, verdict_for_last_row

__all__ = [
    "CheckResult",
    "FrameResult",
    "NodeCard",
    "RunResult",
    "WatchRunner",
    "assemble_frame",
    "build_nodes",
    "closed_frame",
    "frame_from_candles",
    "run_check",
    "trace_names_for",
    "verdict_for_last_row",
]

"""백테스트 모드 백엔드 패키지.

docs/architecture/backtest-mode-plan.md §6.1의 패키지 구조를 따른다. 이 파일은
`backtest`를 임포트 가능한 패키지로 만드는 것 외에 아무 것도 하지 않는다 —
서브모듈이 늘어날 때마다 여기 재노출을 추가하면 순환 임포트의 진원지가 되기 쉽다.
"""

from __future__ import annotations

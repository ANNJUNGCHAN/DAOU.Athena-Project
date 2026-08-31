"""전략 코드 샌드박스 — 자격증명 없는 별도 프로세스에서 signals만 만든다 (§7.2).

이 패키지의 각 모듈 책임:
- `__main__.py` — 자식 진입점. `python -I -B -m athena_api.backtest.sandbox <jobdir>`로만 실행된다.
- `api.py`      — 전략 코드가 보는 유일한 계산 표면(`athena_bt`).
- `guard.py`    — import 허용목록·`open()` 경로 제한. **사고 방지 수준**(정직한 한계는 guard.py로).
- `host.py`     — 부모 쪽: 프로세스 기동·env 화이트리스트·타임아웃·stdout 캡·결과 회수.

`backtest/__init__.py`와 같은 이유로 여기서는 재노출하지 않는다 — 서브모듈이 늘어날 때마다
재노출을 추가하면 순환 임포트의 진원지가 되기 쉽다. 호출부는 필요한 모듈을 직접 임포트한다.
"""

from __future__ import annotations

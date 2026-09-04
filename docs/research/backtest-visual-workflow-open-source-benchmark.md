# 비개발자용 시각 백테스트 전략 저작 — 오픈소스 벤치마크

- 작성일: 2026-09-03 KST
- 상태: 리서치 제안. 구현·의존성 추가·외부 엔진 도입 결정은 포함하지 않는다.
- 질문: 이미 Python으로 작성 가능한 Athena 백테스트에서, Python을 모르는 사람이 n8n처럼 시각적으로 전략을 만들게 하려면 무엇을 가져오고 무엇을 피해야 하는가?
- 조사 기준: 프로젝트 현재 구조와 각 프로젝트의 공식 문서·공식 저장소·공식 릴리스/라이선스 페이지. 버전·활동성은 이 날짜에 확인한 스냅샷이며 이후 바뀔 수 있다.

## 결론

Athena에는 **새로운 범용 워크플로 실행기나 외부 백테스트 엔진을 임베드하지 말고**, 현재의 선언형 `StrategySpec -> signals DataFrame -> engine` 경로 앞에 **제한된 도메인 그래프 편집기**를 둔다. 그래프는 Python의 그림이 아니라, 현재 폼이 표현하는 지표·조건·리스크의 시각적 저작 방식이다.

권장 조합은 다음과 같다.

1. **제품 방향:** “n8n의 캔버스 경험”만 벤치마크한다. n8n 자체는 소스-공개 fair-code/Sustainable Use License이고, 제품 안에 고객용 편집기를 노출하는 임베드 용도는 상업 라이선스가 필요할 수 있으므로 기술 기반으로 채택하지 않는다. [공식 라이선스 안내](https://docs.n8n.io/sustainable-use-license/), [임베드 FAQ](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case)
2. **시각 편집기의 단계적 선택:** P0는 새 프레임워크 없이 현재 DOM/SVG와 이미 설치된 `vis-network`의 조작 API로 UX 가설만 검증한다. 제품급 포트·타입·검증·undo/redo가 실제 요구로 확인되면, 현재 비-React Electron 구조에는 **Rete.js + Lit**가 후보 1순위다. **React Flow**는 React island 또는 앱 표준화 결정을 명시적으로 내린 뒤에만 후보가 된다. [vis-network 조작 API](https://visjs.github.io/vis-network/docs/network/manipulation.html), [Rete Lit 렌더러](https://retejs.org/docs/guides/renderers/lit/), [React Flow 접근성](https://reactflow.dev/learn/advanced-use/accessibility)
3. **실행·정확성의 SSoT:** 그래프 JSON을 서버에서 검증해 **기존 `StrategySpec`으로 컴파일**하고, 이미 두 저작 경로가 합류하는 `entry`/`exit` 신호 계약과 기존 엔진을 그대로 사용한다. 브라우저 그래프나 LLM 출력이 체결·비용·성과 계산을 직접 수행하면 안 된다.
4. **Python 공존:** Python 전략은 계속 “고급 모드”로 남긴다. 시각 그래프가 표현할 수 없는 코드는 `코드 전용`으로 명시하고, AST가 읽을 수 있는 지원 부분만 읽기 전용 흐름 지도로 보여준다. Python을 임의의 그래프로 역변환해 그럴듯한 결과를 만들지 않는다.

이 방향은 비개발자에게는 “블록을 연결해 전략을 만든다”는 경험을 주고, 현재 Athena의 검증·버전·데이터 승인·샌드박스 경계를 보존한다.

## Athena 현재 기반과 제약

### 이미 있는 기반

| 현재 사실 | 시각 저작기에 주는 의미 |
|---|---|
| 전략은 폼/YAML과 Python 두 경로이고, 둘 다 `signals` DataFrame으로 모여 기존 엔진으로 간다. | 그래프는 세 번째 엔진이 아니라 **폼 경로의 다른 입력 방식**이어야 한다. |
| `StrategySpec`은 지표, 파라미터, 진입/청산 조건(AND/OR), 손절/익절, 비용·데이터를 구조적으로 검증한다. | 그래프 노드는 이 허용된 모델만 표현하고, 포트의 타입과 연결 규칙을 서버 검증한다. |
| Python 흐름은 AST로만 분석해 4단계 지도와 “확실하지 않음”을 반환한다. | Python 코드를 시각 그래프로 “변환 성공”이라고 주장하지 않고, 읽기 전용 설명과 그래프 저작을 분리한다. |
| 실행은 버전·스펙 해시·실행 레코드에 결박되며, 백필/활성화는 사람 클릭 경계가 있다. | 그래프 저장도 버전의 소스 중 하나가 되어야 하며, 그래프 편집이 자동 실행·자동 활성화로 이어져서는 안 된다. |
| Electron UI는 현재 프레임워크 없는 JavaScript이며 의존성에 React/Vue/bundler가 없다. `vis-network`는 이미 설치돼 있다. | P0는 DOM/SVG + `vis-network`로 제한된 UX 가설만 검증한다. 제품급 편집 요구가 확인되면 Rete.js + Lit을 우선 검토하고, React Flow는 의도적 React island/표준화 결정 뒤에만 검토한다. |

근거: [현재 백테스트 계획](../architecture/backtest-mode-plan.md), [파리티 감사](../architecture/backtest-parity-audit.md), [전략 스키마](../../backend/athena_api/backtest/schema.py), [선언형 컴파일러](../../backend/athena_api/backtest/compile.py), [Python AST 흐름 지도](../../backend/athena_api/backtest/flow.py), [앱 의존성](../../app/package.json).

### 제품 제약

- 현재 제품의 1차 전략은 단일 종목·일/주/월 봉, 지표/조건 기반의 벡터화 신호 모델이다. 이벤트 기반·복수자산 포트폴리오 편집기나 실거래 자동화기로 범위를 몰래 넓히면 안 된다.
- 데이터 부족은 승인 전 계획과 백필 잡으로 다뤄진다. 그래프에서 “실행”을 누른다고 데이터 확보나 결과가 보장되는 것은 아니다.
- 백테스트 가정(다음 봉 시가 체결, 비용, 수정주가, 생존 편향 등)은 노드의 숨은 구현이 아니라 결과와 실행 전 검토에 명시돼야 한다. [Athena 계획의 데이터·체결 가정](../architecture/backtest-mode-plan.md#5-데이터-층)

## 벤치마크 범위와 후보 비교

### 1) 노드/그래프 편집 프레임워크

| 후보 | 라이선스·활동성 확인 | 잘하는 일 | Athena 적합성 | 판단 |
|---|---|---|---|---|
| **현재 DOM/SVG + `vis-network`** | Athena에 이미 설치돼 있고, 공식 manipulation API는 add/edit/delete node/edge 이전에 핸들러로 허용·취소할 수 있다. [공식 조작 문서](https://visjs.github.io/vis-network/docs/network/manipulation.html) | 무의존 P0: 팔레트, 노드 선택, 제한된 연결, 서버 검증 오류 표시가 초보자에게 통하는지 확인. | 포트 타입, 검사기, 키보드/스크린리더, undo/redo, 코드 품질을 제품급으로 만들면 직접 구현량이 커진다. | **P0 UX 가설 검증 전용.** 종착점으로 선결정하지 않는다. |
| **Rete.js + Lit** | MIT. 공식 Lit 렌더러는 Lit 3, 노드/소켓/연결/입력 제어의 커스터마이즈를 지원하며 Rete의 처리 엔진과 분리해 쓸 수 있다. [Lit 문서](https://retejs.org/docs/guides/renderers/lit/), [공식 저장소](https://github.com/retejs/rete) | 프레임워크 없는 현재 앱에 Web Components 기반으로 제품급 노드·포트·연결·history/minimap/validation UX를 넣을 현실적 후보. | `rete-engine`을 사용하면 Athena 엔진을 이중화한다. Lit과 패키지 추가/테스트/접근성은 별도 검증이 필요하다. | **P0를 통과한 제품급 편집기의 1순위 후보.** UI만 쓰고 실행 엔진은 쓰지 않는다. |
| **React Flow / xyflow** | MIT. 공식 접근성 문서는 키보드 포커스, 이동, ARIA, 한글화 가능한 안내 문구를 제공한다고 설명한다(2026-08-24 갱신). [접근성 문서](https://reactflow.dev/learn/advanced-use/accessibility), [저장소](https://github.com/xyflow/xyflow) | 성숙한 React 노드 UI와 접근성 기준선. | 현재 앱에는 React/번들 표준이 없다. island 하나가 장기 UI 표준을 암묵적으로 결정할 수 있다. | **조건부 후보.** React island 또는 앱 표준화가 별도 결정된 뒤에만 평가한다. |

### 도구 선택의 stop/graduate gate

| P0에서 확인할 사실 | 통과(graduate) | 중단/유지(stop) |
|---|---|---|
| 비개발자가 팔레트에서 지표·비교·진입·청산을 만들고, 잘못된 연결을 이해해 고칠 수 있는가 | DOM/SVG + `vis-network` 프로토타입으로 5개 대표 전략의 작성·저장·검증 시나리오를 관찰하고, 제품급 요구(포트 타입, 대규모 undo/redo, 자동배치, 재사용 노드)가 실제로 드러난다. 그때 Rete.js + Lit 스파이크로 진급한다. | 사용자가 설정 패널/단순 그래프만으로 전략을 완성하거나, 전략 문법이 아직 자주 바뀐다. 새 편집기 의존성을 추가하지 않고 DOM/SVG 경로를 유지한다. |
| 접근성과 현 UI 표준을 지킬 수 있는가 | 키보드 연결/삭제, 포커스, 스크린리더 대체 목록, 한글 IME, Electron 테스트가 통과한다. React 앱 표준화가 승인된 경우에만 React Flow를 Rete와 동등 후보로 올린다. | 이 기준을 통과하지 못하거나 React island가 별도 앱 표준을 강제한다. 프레임워크 선택을 미루고 IR/검증부터 유지한다. |

어느 렌더러를 선택해도 시각 편집기는 업무 실행기가 아니다. 그래프의 의미·유효성·실행은 백엔드가 계속 소유한다.

### 2) “n8n처럼 보이는” 실행 워크플로 제품

| 후보 | 라이선스·활동성 확인 | 빌려올 패턴 | 피할 것 | 판단 |
|---|---|---|---|---|
| **n8n** | n8n은 스스로 fair-code 워크플로 자동화 플랫폼이라 설명한다. 2026-09-03에 확인한 공식 릴리스 목록에는 최근 릴리스가 있다. 소스는 Sustainable Use License이며 고객이 쓰는 편집기를 제품에 임베드하려면 Embed 상업 라이선스가 필요할 수 있다. [저장소](https://github.com/n8n-io/n8n), [SUL](https://docs.n8n.io/sustainable-use-license/), [임베드 조건](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case) | 팔레트·캔버스·노드 설정·실행 관찰성은 **UX 가설**로만 벤치마크한다. 이 보고서는 n8n의 실패 노드 이동, 수동 승인, 버전 비교가 Athena에 그대로 존재한다고 주장하지 않는다. | 코드/런타임/노드 생태계의 임베드·포크·재배포. **OSI 오픈소스가 아니다.** | **주요 UX 벤치마크, 채택 금지.** 법무 검토 없이 코드 복사·임베드 금지. |
| **Node-RED** | Apache-2.0. 2026-09-03에 공식 릴리스·문서 페이지를 재확인했다(특정 최신 버전은 이 결정의 근거로 사용하지 않는다). [릴리스](https://github.com/node-red/node-red/releases), [공식 문서](https://nodered.org/docs/) | 브라우저 에디터, 드래그형 팔레트, 노드 인포 패널, 작은 재사용 단위(subflow), 프로젝트/버전 관리. [에디터 안내](https://nodered.org/docs/user-guide/editor/), [흐름 설계 지침](https://nodered.org/docs/developing-flows/) | 범용 메시지 런타임·JS Function 노드·임의 npm 노드 설치. 기본 편집기는 접근 가능한 네트워크에 보안 없이 노출될 수 있다는 운영 경고도 있다. [공식 보안 문서](https://nodered.org/docs/user-guide/runtime/securing-node-red) | **가장 좋은 실행/운영 패턴 벤치마크.** Athena 안에 Node-RED 서버를 넣지 않는다. |
| **Activepieces** | 코어 MIT, enterprise/cloud 일부는 상용 라이선스. 2026-09-03에 공식 라이선스·릴리스 목록을 재확인했다(특정 최신 버전은 이 결정의 근거로 사용하지 않는다). [공식 라이선스](https://www.activepieces.com/docs/about/license), [릴리스](https://github.com/activepieces/activepieces/releases) | 단계별 실패 표시, 실행 진행 상태, 승인·권한 표시는 **Athena가 별도로 사용자 검증할 UX 가설**이다. 이 보고서는 Activepieces의 세부 동작을 Athena 기능으로 이식한다고 주장하지 않는다. | 별도 워커·커넥터·자격증명·SaaS 플랫폼을 Athena 백테스트에 도입하는 일. | **보조 UX/운영 참조.** 라이선스는 n8n보다 단순하지만 도입 범위가 과하다. |
| **Apache NiFi** | Apache-2.0, 공식 문서가 2026년 NiFi 2.11.0을 제공한다. [공식 문서](https://nifi.apache.org/documentation/) | 대규모 데이터 흐름의 provenance, 큐·백프레셔·명확한 운영 관찰성. | Java 서버/클러스터형 데이터플로 제품 전체. 단일 데스크톱 백테스트에 비례하지 않는다. | **운영 모델 참고만.** |

### 3) 직접 시각 트레이딩 도메인 벤치마크

| 후보 | 라이선스·상태 | Athena가 빌릴 것 | 경계 |
|---|---|---|---|
| **Superalgos** | Apache-2.0이며 공식 저장소는 시각적 전략 설계, 통합 차트, 백테스트/페이퍼 트레이딩을 표방한다. [저장소/라이선스](https://github.com/Superalgos/Superalgos) | 이 조사에서 가장 직접적인 시각 트레이딩 벤치마크다. 노드가 무작정 선으로 연결되는 대신 구조·부착 규칙을 갖게 하는 사고, 계층적 작업공간, 전략/시뮬레이션 실행 흔적을 화면에 연결하는 방식, JSON형 workspace snapshot 아이디어를 빌린다. [노드·구조 문서](https://superalgos.org/Docs/Foundations/Topic/nodes-and-structures-of-nodes.shtml), [사용자 매뉴얼](https://superalgos.org/Docs/Foundations/Book/user-manual.shtml) | 거대한 암호화폐 중심 플랫폼, 브라우저/서버 운용, 계정·자격증명·workspace 결합, 배포·실거래 기능은 가져오지 않는다. Athena에서는 node/edge IR과 전략 버전 snapshot만 독립 저장한다. |
| **Hummingbot Dashboard** | Apache-2.0. 공식 설명은 설정 생성→백테스트/최적화→배포/관리 흐름을 말하며, 2026-09-03에 확인한 공개 릴리스 목록의 최신 표시는 2024-10-28이다. [저장소](https://github.com/hummingbot/dashboard), [설정 문서](https://hummingbot.org/dashboard/config/), [백테스트 문서](https://hummingbot.org/dashboard/backtest/) | 폼/컨트롤러 설정을 먼저 만들고, 백테스트 결과와 실행 상태를 그 설정에 귀속시키며, 버전/배포 전 검토를 분리하는 UX. | **의존성 채택 금지.** Dashboard와 API의 backtest/컨테이너 경로 불일치는 **2026년 공개 이슈에 보고된** contract-drift 사례다. 공식 문서에 명시적 “deprecated” 표기는 확인하지 못했으므로, 이를 “공식 폐기”라고 단정하지 않는다. [backtest issue #279](https://github.com/hummingbot/dashboard/issues/279), [container issue #280](https://github.com/hummingbot/dashboard/issues/280), [공식 quickstart](https://hummingbot.org/blog/hummingbot-dashboard-quickstart-guide/) |

Superalgos에서 얻는 핵심은 **시각 노드가 곧 실행 권한이 아니라, 타입·부모/자식 구조·허용 부착 규칙을 가진 도메인 객체**여야 한다는 점이다. Athena의 `VisualStrategyGraph`도 각 포트 타입과 허용 연결을 registry에 고정하고, 사용자의 캔버스 위치/접힘 상태와 정규화한 전략 소스·버전 snapshot을 분리해야 한다. Superalgos의 전체 workspace나 자격증명 모델을 흉내 내는 것은 필요한 범위를 크게 넘는다.

### 4) 퀀트/백테스트 플랫폼

| 후보 | 라이선스·활동성 확인 | 벤치마크할 개념 | Athena에 넣지 않는 이유 | 판단 |
|---|---|---|---|---|
| **QuantConnect LEAN** | Apache-2.0. 공식 저장소는 2026-07 커밋 활동을 보이며, Python/C# 알고리즘의 로컬 백테스트·최적화·라이브를 CLI/Docker로 지원한다고 설명한다. [저장소](https://github.com/QuantConnect/Lean), [CLI 로컬 실행 문서](https://www.quantconnect.com/docs/v2/lean-cli/backtesting/deployment) | 알고리즘/데이터/브로커 모듈 경계, 재현 가능한 실행, 회귀 알고리즘, 결과와 실행 환경의 결박. | C# 중심의 대형 이벤트 엔진과 Docker 전제가 Athena의 pandas·Electron·키움 제약에 맞지 않는다. | **엔진 신뢰성 기준의 최고급 참조.** 직접 교체 금지. |
| **Freqtrade** | GPL-3.0, 2026-06-03 `2026.5.1` 릴리스. 데이터가 있어야 백테스트가 가능하고 결과/체결을 내보내는 계약을 공식 문서가 명시한다. [공식 백테스트 문서](https://www.freqtrade.io/en/latest/backtesting/), [저장소](https://github.com/freqtrade/freqtrade) | 데이터 사전 조건, 결과/체결 산출물, look-ahead 분석처럼 사용자가 오해할 지점을 별도 검증하는 태도. | GPL-3.0 코드를 제품에 결합하는 것은 라이선스 검토가 필요하고, 암호화폐 거래 도메인이다. | **결과 검증 UX 참조만.** |
| **backtrader** | GPLv3+이며 공식 저장소/사이트가 프레임워크·지표·체결 모델을 설명한다. 공개 활동은 최근 제품보다 약하다(저장소 검색 스냅샷상 2024년 갱신). [공식 사이트](https://www.backtrader.com/), [공식 저장소](https://github.com/mementum/backtrader), [라이선스 선언](https://github.com/mementum/backtrader/blob/master/setup.py) | 수수료·슬리피지·주문유형을 결과 가정으로 노출하는 모델. | GPL과 노후화 위험, Athena의 이미 존재하는 엔진과 중복. | **행동 테스트 아이디어만.** |
| **VectorBT** | 공식 저장소는 현재 Fair Code/Commons Clause 조건을 표시한다. 공식 문서는 `from_signals`가 이미 정해진 entry/exit 신호를 포트폴리오로 모델링한다고 설명한다. [공식 사이트](https://vectorbt.dev/), [signals API](https://vectorbt.dev/api/portfolio/base/), [저장소/라이선스](https://github.com/polakowo/vectorbt) | `price + entries + exits + fees` 계약과 대량 파라미터 탐색을 분리하는 생각. | 현 라이선스는 OSI 승인 라이선스가 아니며, 대량 행렬 실험·Numba/Rust 경로는 현재 단일 전략 UX/패키징 범위를 넓힌다. | **신호 IR의 좋은 외부 검증, 의존성 채택 금지.** |

## 라이선스 결론

라이선스는 “GitHub에서 코드를 볼 수 있는가”가 아니라 **Athena 앱에 포함·수정·고객에게 노출할 수 있는가**의 문제다.

- 편집기 UI 라이브러리는 React Flow(MIT) 또는 Rete.js(MIT)처럼 허용적 라이선스를 우선 검토한다.
- n8n과 VectorBT는 현재 공개 소스가 있어도 OSI 승인 오픈소스라는 전제에 두지 않는다. n8n은 제품 내 워크플로 편집기 노출을 명시적으로 상용 Embed 용도로 안내한다. [n8n FAQ](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case)
- Freqtrade와 backtrader는 GPL 계열이다. 이 보고서는 기능 벤치마크이지 링크/임베드 권고가 아니다. 실제 코드 재사용이나 배포 결합 전에는 라이선스 전문 및 배포 모델을 법무/라이선스 담당자가 검토해야 한다.
- Activepieces는 코어 MIT라도 enterprise 경로가 별도 라이선스다. “프로젝트 전체가 MIT”라고 단정하지 않는다. [공식 구분](https://www.activepieces.com/docs/about/license)

## 빌릴 패턴과 금지할 패턴

### 빌릴 패턴

1. **팔레트와 노드 설명:** Node-RED처럼 팔레트에서 시작하되, 모든 Athena 노드는 “무엇을 계산하는지”, 입력/출력 타입, 결과에 미치는 가정을 한글로 즉시 보여준다. Node-RED의 공식 노드 문서도 선택한 노드의 정보를 Info 패널에서 제공한다. [Core nodes](https://nodered.org/docs/user-guide/nodes)
2. **노드 설정은 캔버스 밖의 검사 가능한 폼:** SMA 노드는 기간, 비교 노드는 기준값/대상, 리스크 노드는 손절/익절을 오른쪽 검사기에서 수정한다. 연결선 위에 임의 식을 쓰게 하지 않는다.
3. **실행 결과를 그래프에 귀속:** 실행 후 각 노드에 계산된 파라미터, warm-up, 검증 경고를 오버레이하고 오류는 해당 노드·포트로 이동한다. 전체 흐름의 유지보수성이 나빠지는 것을 막기 위해 흐름을 작은 재사용 단위와 문서로 관리하라는 Node-RED 지침도 이 방향을 뒷받침한다. [Developing flows](https://nodered.org/docs/developing-flows/)
4. **버전·검토·승인 분리:** 초안 저장 → 정적 검증 → 데이터 계획/승인 → 실행 → 결과라는 명시적 상태를 유지한다. 실패한 단계로 이동하고 진행 상태를 보여 주는 것은 n8n/Activepieces에서 검증할 **UX 가설**이며, Athena에서는 백필과 활성화를 자동화하지 않는다.
5. **정확성의 visible contract:** Lean의 모듈식 엔진 경계, Freqtrade의 “과거 데이터가 먼저 있어야 함” 계약, VectorBT의 entry/exit 신호 기반 포트폴리오 모델은 Athena의 현재 신호 계약을 강화하는 참조다. [LEAN](https://github.com/QuantConnect/Lean), [Freqtrade](https://www.freqtrade.io/en/latest/backtesting/), [VectorBT](https://vectorbt.dev/api/portfolio/base/)

### 피할 패턴

- `Code`/`Function`/HTTP/쉘/임의 패키지 노드를 V1 팔레트에 넣지 않는다. 그래프가 Python 샌드박스를 우회하거나 데이터·계정·네트워크 접근을 열어서는 안 된다.
- 노드가 직접 매수/매도하거나 실거래 활성화를 만드는 설계를 넣지 않는다. 이 기능은 백테스트 전략 저작과 별도의 권한·승인 제품이다.
- 프런트엔드가 그래프를 신뢰해 결과를 계산하게 하지 않는다. 브라우저는 편집·표시만 하고, 서버가 정규화·검증·컴파일한다.
- Python 전략을 자동으로 “완전한” 그래프로 역컴파일하지 않는다. 조건 분기, 사용자 함수, pandas 연산 등 지원 밖 구조는 `코드 전용`이라고 남긴다.
- 빈 노드/모호한 연결을 기본값으로 조용히 채우지 않는다. 예를 들어 `SMA(20)`의 기간, 데이터 주기, 비용, 체결 가정이 비어 있으면 검증 오류 또는 검토 질문이어야 한다.

## 권장 목표 아키텍처

### 1. 도메인 제한 그래프 IR을 추가한다

`VisualStrategyGraph v1`은 제품의 화면 상태가 아니라 저장·검증 가능한 전략 소스다. 범용 워크플로 JSON이 아니다.

```text
VisualStrategyGraph v1
  graph_version
  nodes[]: { id, kind, params, ui? }
  edges[]: { from: { node, port }, to: { node, port } }
  metadata: { name, description, tags }
  scenario: { data, costs, risk }       # 캔버스 옆의 검토 패널에서도 동일하게 보임
  compiler_version
```

V1 노드 종류는 현재 `StrategySpec`이 이미 말할 수 있는 것만 허용한다.

| 그룹 | 허용 노드 | 포트 예 |
|---|---|---|
| 데이터 | `OHLCV` 읽기 전용 소스 | `open`, `high`, `low`, `close`, `volume`: `series<number>` |
| 지표 | 현재 레지스트리의 SMA/EMA/RSI/MACD 등 | `series<number>` 또는 명명된 복수 출력 |
| 비교 | 교차상향/교차하향/초과/미만/이상/이하/같음 | `series<boolean>` |
| 논리 | AND/OR | `series<boolean>` → `series<boolean>` |
| 신호 | `진입`, `청산` (각 정확히 하나) | 조건 입력 → `entry`/`exit` |
| 시나리오 | 종목·기간·수정주가, 비용, 손절/익절, 포지션 | 그래프 선이 아닌 설정 패널; 저장/검증에는 포함 |

금지 노드는 `Python 실행`, `JS 실행`, `HTTP`, `파일`, `계정`, `실거래`, `반복`, `임의 표현식`이다. 이 결정은 초보자에게 필요한 표현력보다 검증 가능성·재현성·안전성이 우선이라는 뜻이다.

### 2. 컴파일 파이프라인은 하나만 둔다

```text
[시각 그래프] --서버 검증/정규화--> [StrategySpec] --기존 compile.py--> [signals DataFrame]
                                                                         |
[Python 전략] --기존 sandbox-----------> [signals DataFrame] ----------+--> [기존 engine / trades / equity / metrics]
```

- 그래프 검증: 노드 kind/파라미터 스키마, 포트 타입, 필수 입력, cycle 금지, 정확히 하나의 진입·청산 출력, 지표 별칭 충돌, 현재 지원하지 않는 다중 출력 참조를 검사한다.
- 그래프 컴파일: 그래프의 지표를 현재 `StrategySpec.strategy.indicators`로, 비교/논리를 `entry`/`exit` `ConditionGroup`으로 만든다. 그래프가 표현하지 못하는 현 `StrategySpec` 속성이 있으면 컴파일하지 말고 명시적인 오류로 막는다.
- 엔진 계약(현재 구현): 컴파일러는 `entry`와 `exit` 두 열만 만들고, 엔진도 그 두 열만 읽어 전액 단일 포지션(all-in)으로 실행한다. `size`는 계획 문서의 향후 선택적 신호 계약일 뿐, 현재 `compile.py`가 만들거나 `engine.py`가 소비하지 않는다. 시각 그래프 V1도 `size` 포트를 만들지 않는다. 체결·세금·슬리피지·성과는 기존 서버 엔진의 전권이다.
- 저장: 새 전략 버전은 `origin=visual`(제안)과 원본 graph JSON, 정규화된 spec, compiler version, spec hash를 함께 기록한다. 결과에는 strategy version id와 graph/spec snapshot을 표시한다.

이 구조는 현재 `StrategySpec`과 `compile_signals()` 계약을 바꾸지 않으므로, 같은 그래프와 같은 데이터·비용·엔진 버전이면 기존 재현성 축을 유지한다.

### 3. Python과의 관계

- **그래프 → Python:** V1에는 필요 없다. 그래프가 곧 선언형 SSoT이며 YAML 미리보기는 제공할 수 있다. Python 코드를 생성하려면 별도 “내보내기(참고용)”이고 실행 SSoT로 취급하지 않는다.
- **Python → 그래프:** 현재 AST `flow` API가 지원하는 선형 지표/조건의 일부만 읽기 전용 “설명 지도”로 보여준다. 완전 변환 불가면 `이 전략은 코드 전용입니다`와 해당 코드 줄·미지원 이유를 보인다.
- **공통 비교:** 같은 `signals` 계약으로 실행 결과를 비교하되, Python의 숨은 로직을 그래프의 동등물로 가정하지 않는다.

## 코드→그래프 벤치마크: 설명용 AST와 편집용 IR은 다르다

| 도구 | 확인된 성격 | Athena에서의 결론 |
|---|---|---|
| **code2flow** | 동적 언어의 call graph를 AST와 휴리스틱으로 **근사**하며, 저장소 자체도 완벽한 call graph 생성이 불가능하다고 명시한다. [공식 저장소](https://github.com/scottrogowski/code2flow) | Python 전략의 함수/호출 관계를 읽기 전용으로 설명하는 데는 유용한 벤치마크지만, 편집 후 같은 거래 의미가 보존된다는 증거가 없다. |
| **pyflowchart** | Python 코드를 flowchart로 바꾸는 MIT 도구이며 Python `ast` 기반임을 공식 저장소가 밝힌다. [공식 저장소](https://github.com/cdfmlr/pyflowchart) | 제어 흐름 설명·문서화에는 적합하지만, 지표·데이터 시계열·체결 가정·포트 타입을 가진 백테스트 전략을 편집 가능한 의미 그래프로 만들지는 않는다. |

따라서 현재 Athena의 `flow.py` AST 흐름 지도는 **코드에서 관찰 가능한 범위만 정직하게 보여주는 읽기 전용 설명물**로 유지한다. 반대로 `VisualStrategyGraph v1`은 사용자가 새로 만드는 선언형 도메인 IR이며, 서버가 `StrategySpec`으로 컴파일하고 실행한다. 둘을 같은 객체나 양방향 무손실 변환으로 취급하지 않는다.

## 제안 UX: 20일/60일 이동평균 교차 전략

```text
┌─ 데이터·가정 (고정 검토 패널) ──────────────────────────────────────────────┐
│ 삼성전자 | 일봉 | 2022-01-01 ~ 2026-08-31 | 수정주가 | 비용/슬리피지 | 다음 봉 시가 │
└───────────────────────────────────────────────────────────────────────────┘

 [종가 OHLCV] ──┬──> [SMA 20] ──┐
                │               ├──> [교차 상향] ──> [진입 신호]
                └──> [SMA 60] ──┘
                                └──> [교차 하향] ──> [청산 신호]

                  [손절 8%] [익절 20%] [전액]  ← 선이 아닌 리스크 설정

 [검증] → “SMA 60: 처음 59봉은 계산 대기” → [데이터 계획] → [수집 승인] → [실행]
```

각 블록은 이름·한 줄 설명·현재 파라미터·입출력 타입을 보여준다. `교차 상향`을 선택하면 “두 선이 오늘 처음 위로 바뀌는 날만 진입 신호”라는 한글 설명과 원본 데이터/지표 미리보기를 보여준다. 결과 화면은 이 전략 그래프, 실행 버전, 데이터 범위, 체결 가정을 한 화면에서 함께 보여야 한다.

## 단계별 제품 계획

### P0 — 계약 고정과 작은 기술 스파이크

- 지원할 `VisualStrategyGraph v1` 노드/포트 표와 graph→`StrategySpec` 매핑을 문서와 JSON 스키마로 확정한다.
- 현재 프런트의 DOM/SVG와 설치된 `vis-network` manipulation handler로 제한된 편집 화면을 만든다. 이 단계는 라이브러리 채택이 아니라 팔레트·연결·검사기·오류 피드백의 UX 가설 검증이다.
- P0가 제품급 포트 타입·재사용/자동배치·history·대규모 그래프 요구를 확인하면 Rete.js + Lit 스파이크로 진급한다. React Flow 스파이크는 React island 또는 앱 표준화가 별도 승인된 경우에만 허용한다.
- golden fixture 10개(프리셋 포함)에서 기존 YAML과 그래프 컴파일 결과의 정규화 `StrategySpec` 및 `signals`가 같음을 테스트한다.
- **완료 기준:** 신규 그래프가 런타임/직접 거래 권한을 얻지 않고, 검증 실패가 노드/포트 위치로 돌아온다.

### P1 — 초보자용 최소 그래프 작성

- 팔레트: OHLCV, 지원 지표, 비교 7종, AND/OR, 진입, 청산만 제공한다.
- 오른쪽 검사기와 캔버스 외부 시나리오 패널에서 값을 설정한다. 입력되지 않은 필수값은 실행 버튼을 비활성화하고 이유를 한국어로 표시한다.
- undo/redo, 자동 배치, 미니맵보다 먼저 키보드 추가/연결/삭제, 목록형 대체 보기, 노드 도움말을 만든다.
- **완료 기준:** 비개발자가 위 SMA 교차 예제를 저장·검증·데이터 계획까지 갈 수 있고, 그래프가 기존 폼과 동일한 `StrategySpec`을 만든다.

### P2 — 버전·결과·검토 연결

- 그래프 초안을 전략 버전으로 저장하고 그래프 diff(노드·엣지·파라미터)와 YAML/spec diff를 제공한다.
- 기존 데이터 커버리지/백필 승인/실행/결과/체결 API를 재사용한다. 그래프 탭에서 백필 또는 활성화가 자동 실행되지 않게 한다.
- 결과의 수익률만 강조하지 않고, 데이터 범위·수수료·슬리피지·체결 규칙·워밍업·지원 밖 항목을 고정된 “가정” 카드로 표시한다.
- **완료 기준:** 과거 실행을 그때의 그래프 snapshot과 version id로 재현·설명할 수 있다.

### P3 — 고급 모드와 신뢰성 강화

- Python 전략에는 현재 AST 흐름 지도를 개선해 지원/미지원 범위를 명시한다. “그래프로 편집”은 컴파일러가 증명할 수 있는 subset에만 열고 나머지는 코드 전용으로 남긴다.
- 프리셋과 그래프의 등가 테스트, cycle/타입 오류 퍼징, 렌더러 접근성 테스트, 결과 가정 회귀 테스트를 추가한다.
- 다중 자산, 이벤트/주문형 전략, 사용자 정의 지표, 실거래 연결은 별도 요구사항·리스크·권한 설계가 승인되기 전까지 포함하지 않는다.

## 리스크, 보안, 접근성, 한국어 UX

| 영역 | 위험 | 설계 원칙/검증 |
|---|---|---|
| 신뢰성 | 연결선 하나가 가려져 전략 의미를 오해하거나, UI와 엔진 결과가 갈림 | 서버 단일 컴파일러, version/spec hash, graph snapshot, golden signal fixtures. “그래프 보기”와 “실행한 버전”을 분리하지 않는다. |
| 금융 안전 | 사용자가 백테스트를 실거래/수익 보장으로 오해 | 화면에 데이터 범위·비용·체결 가정·미지원 항목을 상시 표시. 백필/활성화/주문은 기존 사람 승인 경계를 보존한다. |
| 보안 | 노드 파라미터·레이블·import가 코드 실행/파일/네트워크 경로가 됨 | 그래프는 선언형 allowlist JSON만 수용, 서버 스키마 검증, 노드 유형 registry 고정, 사용자 문자열 escape, 권한별 API. Python sandbox는 그래프와 별도 경계로 남긴다. Node-RED도 편집기를 노출할 때 인증·HTTPS·권한을 별도로 설정해야 한다고 경고한다. [공식 보안 문서](https://nodered.org/docs/user-guide/runtime/securing-node-red) |
| 성능 | 큰 그래프/미니맵/자동 배치가 Electron을 멈춤 | V1 노드 수 상한과 점진 렌더링, layout은 명시적 사용자 동작 때만, 실행 계산은 서버 잡으로 유지. 성능 수치는 구현 뒤 실측한다. |
| 접근성 | 드래그 전용 노드 캔버스는 키보드/스크린리더 사용자를 배제 | 같은 그래프의 구조화된 목록/폼 대체 보기를 제공하고, 키보드로 노드 선택·추가·연결·삭제·검사기 이동을 지원한다. 포커스가 항상 보이고 가려지지 않게 한다는 WCAG 2.2 기준을 테스트한다. [W3C WCAG 2.2](https://www.w3.org/TR/wcag/), [Focus Visible 해설](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible) |
| 한국어/현지화 | 엔진 식별자와 번역된 표시명이 섞여 저장 포맷·공유·검색이 깨짐 | 저장 IR에는 안정적 영문 `kind`/port id를, UI에는 분리된 한국어 label·help를 둔다. 전략 이름·설명은 Unicode 그대로 보존하고 locale별 숫자/날짜 표시만 화면에서 처리한다. 문자열 데이터에는 언어/방향 메타데이터가 필요하다는 W3C 지침과도 맞는다. [W3C string metadata](https://www.w3.org/TR/string-meta/) |

## 짧은 후보 목록과 다음 결정

| 순위 | 선택 | 결정해야 할 것 |
|---|---|---|
| 1 | **도메인 그래프 IR + 기존 Athena 컴파일러/엔진** | 이 보고서의 핵심 권고. 외부 실행 플랫폼을 도입하지 않는다. |
| 2 | **DOM/SVG + `vis-network` P0** | 현재 스택 안에서 초보자용 연결/검증 UX가 실제로 필요한지 확인한다. 이는 제품급 편집기 채택이 아니다. |
| 3 | **Rete.js + Lit 제품급 스파이크** | P0에서 포트 타입·history·재사용·대형 그래프 요구가 입증될 때만 UI로 검증한다. `rete-engine`은 쓰지 않는다. |
| 조건부 | **React Flow** | React island 또는 앱 표준화가 명시적으로 결정된 경우에만 접근성·IME·테스트 기준으로 Rete와 비교한다. |
| 참조 | Superalgos, Node-RED, n8n, Activepieces, Hummingbot Dashboard | 노드 구조/작업공간, 팔레트·검사기·실행 이력·오류 점프·승인 UX의 벤치마크. 제품 코드/런타임 임베드는 하지 않는다. |
| 참조 | LEAN, Freqtrade, backtrader, VectorBT, code2flow, pyflowchart | 재현성·데이터 조건·체결/비용 가정·신호 IR과 AST 설명의 품질 기준. 코드/엔진 결합은 하지 않는다. |

실행 전 단 하나의 제품 결정을 먼저 고르면 된다: **V1을 “현재 폼의 시각적 등가물(선언형 지표·조건 전략)”로 제한한다.** 이 제한을 승인하면 기술 선택은 현재 스택에서 P0 DOM/SVG + `vis-network` UX 검증으로 좁아지고, 제품급 요구가 입증될 때만 Rete.js + Lit으로 진급한다. Python을 모르는 사용자는 즉시 혜택을 받고 고급 Python 사용자와 기존 결과 재현성도 보호된다.

## 근거의 한계

- 본 문서는 공개 문서·저장소를 기준으로 한 벤치마크다. 특정 라이브러리의 실제 번들 크기, 렌더 성능, 한국어 IME, Athena의 패키징·테스트 호환성은 아직 측정하지 않았다.
- 라이선스 표기는 공식 페이지의 현재 공개 조건을 요약한 것이며 법률 자문이 아니다. 실제 배포/임베드 전 해당 버전의 라이선스 전문과 상업 조건을 재검토해야 한다.
- 과거 백테스트 성과나 사용자 생산성 수치를 주장하지 않는다. P0 이후 정의된 사용성 시나리오와 Athena 실데이터로 측정해야 한다.

## 공식 소스 색인

### 시각 편집기

- 현재 스택: [vis-network 조작 API](https://visjs.github.io/vis-network/docs/network/manipulation.html)
- Rete.js: [Lit 렌더러](https://retejs.org/docs/guides/renderers/lit/), [API/플러그인 문서](https://retejs.org/docs/api/), [공식 저장소](https://github.com/retejs/rete)
- React Flow: [제품/라이선스](https://reactflow.dev/), [접근성/한글화 가능한 ARIA 문구](https://reactflow.dev/learn/advanced-use/accessibility), [공식 저장소·활동](https://github.com/xyflow/xyflow)

### 워크플로 제품

- n8n: [Sustainable Use License](https://docs.n8n.io/sustainable-use-license/), [임베드 라이선스 FAQ](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case), [공식 릴리스](https://github.com/n8n-io/n8n/releases)
- Node-RED: [에디터 가이드](https://nodered.org/docs/user-guide/editor/), [흐름 설계](https://nodered.org/docs/developing-flows/), [보안](https://nodered.org/docs/user-guide/runtime/securing-node-red), [Apache-2.0 저장소/릴리스](https://github.com/node-red/node-red/releases)
- Activepieces: [라이선스](https://www.activepieces.com/docs/about/license), [공식 릴리스](https://github.com/activepieces/activepieces/releases)
- Apache NiFi: [공식 문서/Apache-2.0 고지](https://nifi.apache.org/documentation/)
- Superalgos: [Apache-2.0 저장소](https://github.com/Superalgos/Superalgos), [노드·구조](https://superalgos.org/Docs/Foundations/Topic/nodes-and-structures-of-nodes.shtml), [사용자 매뉴얼](https://superalgos.org/Docs/Foundations/Book/user-manual.shtml)
- Hummingbot Dashboard: [Apache-2.0 저장소](https://github.com/hummingbot/dashboard), [설정 생성](https://hummingbot.org/dashboard/config/), [백테스트](https://hummingbot.org/dashboard/backtest/), [backtest contract-drift issue #279](https://github.com/hummingbot/dashboard/issues/279), [container contract-drift issue #280](https://github.com/hummingbot/dashboard/issues/280)

### 백테스트 플랫폼

- LEAN: [공식 저장소/Apache-2.0](https://github.com/QuantConnect/Lean), [로컬 백테스트 배포 문서](https://www.quantconnect.com/docs/v2/lean-cli/backtesting/deployment)
- Freqtrade: [공식 백테스트 문서](https://www.freqtrade.io/en/latest/backtesting/), [GPL-3.0 저장소/릴리스](https://github.com/freqtrade/freqtrade)
- backtrader: [공식 사이트](https://www.backtrader.com/), [GPL-3.0 저장소](https://github.com/mementum/backtrader)
- VectorBT: [공식 기능 문서](https://vectorbt.dev/getting-started/features/), [signals 포트폴리오 API](https://vectorbt.dev/api/portfolio/base/), [공식 저장소/현재 라이선스](https://github.com/polakowo/vectorbt)
- 코드→그래프: [code2flow](https://github.com/scottrogowski/code2flow), [pyflowchart](https://github.com/cdfmlr/pyflowchart)

### 표준

- W3C: [WCAG 2.2](https://www.w3.org/TR/wcag/), [Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible), [문자열 언어/방향 메타데이터](https://www.w3.org/TR/string-meta/)

# 기법 코드 원칙 — 노드가 되는 파이썬을 쓰는 법

**이 문서는 채팅 접두(`app/lib/main/live-prompt.js`의 `techniqueRules`)와 자동 검사
(`backend/athena_api/backtest/technique_check.py`)의 원본이다.** 셋이 어긋나면 사용자는
접두가 시킨 대로 쓴 코드가 검사에 걸리는 일을 겪는다 — 문장을 고칠 때는 여기를 먼저 고치고
접두와 검사를 그 문장에 맞춘다.

대상은 "새 기법 만들기"에서 AI가 쓰는 `strategy.py` 한 장이다. 이 파일 하나가 곧
노드 창이고, 곧 슬라이더이고, 곧 백테스트 실행이다.

## 목차

1. [기법 코드 원칙 10개](#기법-코드-원칙-10개)
2. [노드는 어느 단위로 보는가](#노드는-어느-단위로-보는가)
3. [자동 검사표](#자동-검사표)
4. [좋은 예 — ATR 돌파 6함수](#좋은-예--atr-돌파-6함수)
5. [나쁜 예 3줄](#나쁜-예-3줄)

---

## 기법 코드 원칙 10개

### 1. 계약

> 최상위 `PARAMS`(dict: 이름 → `{default,min,max,step,type}`)와 `signals(df, p)`가 있고,
> `entry`·`exit` 두 bool 열을 돌려준다. 쓸 수 있는 것은 `athena_bt`(as `bt`)·pandas·numpy뿐.

**왜.** 엔진이 이 파일에서 부르는 자리는 `signals(df, p)` 하나뿐이다 — 이름이 다르거나 인자가
둘이 아니면 부를 자리가 없다. `PARAMS`는 **리터럴 딕셔너리**여야 한다: `flow.py`의
`params_defaults()`가 코드를 실행하지 않고 `ast`로 읽어 실행 파라미터의 바닥값을 채우고,
슬라이더와 그리드 서치가 같은 리터럴에서 `min`·`max`·`step`·`type`을 읽는다. 계산식으로 만든
`PARAMS`는 아무도 읽지 못해 `p["period"]`가 `KeyError`로 죽는다.

`import`는 샌드박스 허용목록이 정한다(`sandbox/guard.py`의 `ALLOWED_TOP_LEVEL_IMPORTS`):
`pandas`·`numpy`·`math`·`statistics`·`datetime`·`athena_bt`. 프로젝트 가상환경으로 돌릴 때만
그 환경의 패키지가 얹히고, 차단목록(`os`·`sys`·`subprocess`·`socket`·`urllib`·`http`·`httpx`·
`requests`·`pathlib`·`shutil`·`ctypes`·`importlib`·`builtins`·`io`·`tempfile`·
`multiprocessing`·`threading`·`signal`·`code`·`pickle`·`marshal`)은 어떤 경우에도 열리지 않는다.
함수 안에 숨긴 `import`도 같은 검사를 받는다.

### 2. 노드 단위 = 최상위 함수 하나 = 판단 하나

> `signals()`는 조립(호출 순서)만 하고 계산은 함수로 뺀다. 기본 함수 종류: 지표 계산
> `compute_*`, 진입 판단 `should_enter`, 청산 판단 `should_exit`, 필요 시 손절·익절
> `stop_*`/`take_*`, 비중 `position_size`. 이름이 역할을 정한다(enter/entry/buy → 진입,
> exit/sell/stop/close → 청산, compute_/level/band/line → 지표, size/position/qty → 비중).

**왜.** `technique_nodes.build_nodes()`가 **모듈 최상위 함수만** 노드로 만든다. 함수 안에
중첩된 함수는 노드가 아니고(`_child_statements`가 들어가지 않는다), 클래스도 아니다. 계산을
`signals()` 안에 몰아넣으면 노드가 하나뿐인 그림이 되고, 그건 그림이 아니다.

### 3. 함수 첫 줄 docstring이 곧 노드 설명이다

> 사람 말 한 문장에 숫자·근거를 담는다.
> 예: `"""20봉 최고가에 ATR×배수를 얹은 돌파선을 만든다."""`

**왜.** `_summary()`가 docstring의 **첫 줄**을 노드의 `summary_ko`로 그대로 쓴다. docstring이
없으면 `def` 바로 윗줄부터 이어지는 주석 덩어리의 첫 줄을 쓰고, 그것도 없으면 노드 카드의
설명이 빈칸이 된다 — 사용자가 보는 것은 함수 이름뿐이 된다.

### 4. 미래를 보지 않는다

> `shift(-n)`·`rolling(center=True)`·미래 인덱스 접근 금지. 오늘 종가로 오늘 판단하되
> 체결가는 앱이 다음 봉 시가로 정한다 — 코드가 체결가를 계산하지 않는다.

**왜.** `engine.py`가 규율을 이미 갖고 있다: "체결은 다음 봉 시가 — 같은 봉 종가 체결은
look-ahead다." 코드가 체결가를 따로 계산하면 엔진이 이미 하는 일을 두 번 하는 것이고, 두 값이
갈라졌을 때 화면에 뜨는 성과가 어느 쪽인지 아무도 모른다. 기법 코드가 하는 일은 **언제**를
찍는 것까지다.

### 5. 워밍업

> 지표가 준비되기 전 봉에는 신호를 내지 않는다(NaN은 False).

**왜.** 시험 실행이 남기는 `warmup_bars`는 **선두 무신호 구간**의 길이다 — 지표 프레임을
사용자 코드가 만들기 때문에 앱은 앞 몇 봉이 NaN이었는지 알 수 없고, 실제로 신호가 하나도
없던 앞 구간만 센다. 첫 봉부터 신호가 나오면 지표가 덜 찬 채로 판단했다는 뜻이다.

### 6. 결정성

> 난수·현재 시각·외부 상태를 쓰지 않는다. 같은 입력이면 같은 출력.

**왜.** 같은 코드를 자동 검사의 시험 실행, 본 실행, 최적화 그리드가 각각 여러 번 돌린다.
결과가 매번 달라지면 어느 것이 사실인지 가릴 방법이 없고, 최적화는 잡음을 파라미터의 힘으로
잘못 읽는다.

### 7. 매직 넘버 금지

> 기간·배수·문턱은 전부 `PARAMS`로(범위 포함). 0·1·-1·100·0.5 같은 항등·단위 값만 예외.

**왜.** 슬라이더와 그리드 서치가 읽는 것은 `PARAMS`뿐이다. 코드 줄 안에 박힌 `20`은 화면에
뜨지 않아 사용자가 만질 수 없고, 최적화가 건드릴 수도 없다 — 사실상 없는 손잡이다.

### 8. 한 열 한 뜻

> 중간 열 이름은 무엇인지 드러나게(`atr`, `breakout_level`), `entry`/`exit`는 bool.

**왜.** 흐름 선은 **변수 이름**을 따라 이어진다 — `_chain()`이 `entry` 열을 만든 식에서
거꾸로 이름을 따라가며 실제로 쓰인 함수만 골라낸다. 이름을 재사용하거나 `x1`·`tmp`로 두면
흐름이 엉뚱한 사슬을 그린다. 열 이름 `entry`·`exit`는 엔진 계약이라 바꿀 수 없다(파이썬
예약어를 피한 `exit_`는 같은 열로 읽는다).

### 9. 부작용 없음

> 파일·네트워크·print 남발 금지(샌드박스가 막는다).

**왜.** 샌드박스가 작업 디렉터리 밖 파일 접근과 금지 모듈을 실제로 막는다(`guard.py`). `print`는
막히지 않지만 표준출력의 **마지막 20줄만** 검사 로그로 올라온다 — 많이 찍으면 정작 필요한
오류 줄이 밀려 사라진다.

### 10. 완성 기준은 자동 검사 통과

> 문법·계약·시험 실행 3개가 통과하고 룩어헤드·워밍업 검사가 통과하며 매직 넘버·구조 경고가
> 0이다.

**왜.** 차단 검사가 모두 통과해야 `passed`가 서고, 그때 노드·흐름 창이 열린다. "다 됐다"의
정의를 사람의 눈이 아니라 검사에 두는 이유는 하나다 — 초심자는 어긋난 것을 알아챌 방법이
없기 때문이다.

---

## 노드는 어느 단위로 보는가

**최상위 함수 하나가 노드 하나다.** `build_nodes()`가 모듈을 `ast`로 읽어 최상위 `def`만
노드로 세우고, 노드마다 함수 이름(`id`)·줄 범위(`first_line`–`last_line`)·인자 목록·
`docstring` 첫 줄(`summary_ko`)·역할(`role`)·돌려주는 값의 추정(`returns_hint`)을 붙인다.
**역할은 이름이 정하고**, 이름으로 갈리지 않으면 돌려주는 값이 정한다.

| 함수 이름에 든 낱말 | 역할(`role`) |
| --- | --- |
| `signals`(정확히 그 이름) | `signals` — 조립 |
| `enter` · `entry` · `buy` | `entry` — 진입 판단 |
| `exit` · `sell` · `stop` · `close` | `exit` — 청산 판단 |
| `size` · `sizing` · `position` · `qty` | `sizing` — 비중 |
| 위 어느 것도 아님 + 수치 시리즈를 돌려줌 | `indicator` — 지표 계산 |
| 위 어느 것도 아님 + 그 밖 | `helper` |

이름은 `snake_case`·`camelCase`를 함께 쪼갠 **낱말 단위**로 본다 — `compute_atr`의 어디에도
`enter`가 없으므로 지표로 남는다. 반대로 낱말이 걸리면 무엇을 돌려주든 그 역할이 이긴다:
`compute_stop_level`은 `stop` 때문에 청산으로 읽힌다(손절선은 청산 판단의 일부이니 그대로
두어도 되고, 순수 지표라면 이름에서 그 낱말을 뺀다). 종가 이동평균을 `compute_close_ma`로
지으면 `close` 때문에 청산으로 읽히니 `compute_ma`로 짓는다. `take_profit`은 `take` 낱말로
청산으로 읽힌다(익절도 포지션을 닫는 판단이다).

**흐름은 `signals()`의 호출 사슬이다.** `signals()` 본문에서 `entry` 열과 `exit` 열을 만든
식을 찾아, 그 식이 기대는 변수를 거꾸로 따라가며 실제로 쓰인 함수만 **기대는 것이 앞에 오도록**
늘어놓는다. 두 열을 만든 자리를 못 찾으면 그 갈래는 빈 채로 남고 그 사실이 `unknown`에 실린다.
찾을 수 있는 모양은 샌드박스가 받아주는 모양과 같다 — 변수 대입(`entry = ...`), 열 대입
(`df["entry"] = ...`), `df.assign(entry=..., exit=...)`, `{"entry": ..., "exit": ...}`,
두 시리즈 튜플.

**함수가 `signals()` 하나뿐이면** 노드 하나짜리 그림이 되므로 `flow.py`의 4단계로 폴백한다
(`granularity: "stage"`): ① 조절할 값을 정합니다 → ② 가격을 지표로 바꿉니다 → ③ 사고·파는
순간을 찍습니다 → ④ 두 열만 돌려줍니다. 이때 진입·청산 두 갈래는 비어 있고 한 갈래 단계
흐름만 그려진다. **이 폴백은 성공이 아니라 차선이다** — 함수로 쪼개면 그림이 코드가 된다.

---

## 자동 검사표

| 검사 | 판정 | 무엇을 보는가 |
| --- | --- | --- |
| `syntax` 문법·금지 import | **차단** | `ast.parse`가 되는가. 코드 어디에 있든(함수 안 포함) `import`를 걷어 상대 import·차단목록·허용목록 밖 이름을 잡는다. |
| `contract` signals 계약 | **차단** | 최상위에 `def signals`가 있는가, 위치 인자가 정확히 둘인가, `return`이 `entry`·`exit` 두 열을 돌려주는가. 반환 모양을 정적으로 못 읽으면 판정을 시험 실행에 넘기고 통과시킨다. |
| `dryrun` 짧은 구간 시험 실행 | **차단** | 캐시된 봉 마지막 300개로 `signals`만 샌드박스에서 돌린다. 결과에 두 열이 있는지 보고 워밍업 봉 수·`entry`/`exit` 개수를 센다. 봉 캐시가 없으면 돌린 척하지 않고 "대상을 정하면 시험 실행합니다"로 남는다(통과 아님). |
| `lookahead` 룩어헤드 | **차단** | 원칙 4. 음수 `shift`, `rolling(center=True)`, 미래 인덱스 접근처럼 오늘 판단에 내일 값을 끌어오는 자리. |
| `warmup` 워밍업 | **차단** | 원칙 5. 지표가 준비되기 전 구간에서 신호가 나는가 — 선두 무신호 구간이 지표 기간에 비해 너무 짧으면 걸린다. |
| `magic` 매직 넘버 | 경고 | 원칙 7. `PARAMS` 밖에 박힌 기간·배수·문턱 리터럴. 항등·단위 값(0·1·-1·100·0.5)은 세지 않는다. |
| `structure` 구조 | 경고 | 원칙 2·3. `signals()`가 계산까지 떠안았는가, 노드가 될 함수에 docstring이 없는가. |

차단은 **고쳐야 함** — 하나라도 실패하면 노드·흐름 창이 열리지 않는다. 경고는 **고치면 좋음**
— 통과를 막지 않지만 남겨두면 슬라이더에 안 뜨는 숫자와 설명 없는 노드가 그대로 사용자에게
간다.

검사는 **앞이 실패하면 뒤를 건너뛴다**. 문법이 깨진 코드를 샌드박스에 넣으면 같은 사실을 두 번,
그것도 역추적이라는 더 어려운 말로 다시 듣기 때문이다 — 지금 고칠 것 하나만 보이게 한다.

---

## 좋은 예 — ATR 돌파 6함수

```python
import athena_bt as bt

PARAMS = {
    "atr_period": {"default": 14, "min": 5, "max": 60, "step": 1, "type": "int"},
    "breakout_period": {"default": 20, "min": 5, "max": 120, "step": 1, "type": "int"},
    "atr_mult": {"default": 1.5, "min": 0.5, "max": 5.0, "step": 0.1, "type": "float"},
    "stop_mult": {"default": 2.0, "min": 0.5, "max": 6.0, "step": 0.1, "type": "float"},
}


def compute_atr(df, p):
    """최근 14봉의 참변동폭 평균으로 이 종목이 하루에 얼마나 움직이는지 잰다."""
    return bt.atr(df, period=p["atr_period"])


def compute_breakout_level(df, atr, p):
    """20봉 최고가에 ATR×배수를 얹은 돌파선을 만든다."""
    highest = df["high"].rolling(p["breakout_period"]).max()
    return highest + atr * p["atr_mult"]


def compute_stop_level(df, atr, p):
    """전봉 종가에서 ATR×손절배수만큼 내린 선을 손절선으로 둔다."""
    return df["close"].shift(1) - atr * p["stop_mult"]


def should_enter(df, breakout_level):
    """종가가 돌파선을 넘으면 진입한다 — 돌파선이 아직 없는 앞 봉은 False다."""
    return (df["close"] > breakout_level).fillna(False)


def should_exit(df, stop_level):
    """종가가 손절선을 밑돌면 청산한다 — 손절선이 아직 없는 앞 봉은 False다."""
    return (df["close"] < stop_level).fillna(False)


def signals(df, p):
    """돌파선으로 사고 손절선으로 파는 흐름을 조립한다."""
    atr = compute_atr(df, p)
    breakout_level = compute_breakout_level(df, atr, p)
    stop_level = compute_stop_level(df, atr, p)
    entry = should_enter(df, breakout_level)
    exit_ = should_exit(df, stop_level)
    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]
```

이 코드가 만드는 노드 창은 이렇다.

- 노드 6개: `compute_atr`(지표) · `compute_breakout_level`(지표) · `compute_stop_level`(청산 —
  이름의 `stop`) · `should_enter`(진입) · `should_exit`(청산) · `signals`(조립)
- 흐름 진입: `compute_atr` → `compute_breakout_level` → `should_enter`
- 흐름 청산: `compute_atr` → `compute_stop_level` → `should_exit`
- 슬라이더 4개: `atr_period` · `breakout_period` · `atr_mult` · `stop_mult`

---

## 나쁜 예 3줄

```python
entry = df["close"] > df["close"].shift(-1)          # 내일 종가를 오늘 본다 — lookahead 차단
breakout = df["high"].rolling(20).max()              # 20이 PARAMS에 없다 — magic 경고
def signals(df, p): ...전부 여기서 계산...            # 노드가 하나 — structure 경고 + 4단계 폴백
```

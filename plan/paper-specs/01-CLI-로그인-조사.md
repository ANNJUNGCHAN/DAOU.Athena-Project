# 01 · CLI 로그인 위임 조사 (AT-SY-002 후속)

조사 대상 머신: 현재 세션이 실행 중인 Windows 11 개발 머신(`C:\Users\ajc22`, 사용자 `ajc227ung@gmail.com`).
전제: AT-SY-002 각주 2 "브라우저 로그인 연동 방식(OAuth 리다이렉트 / CLI 로그인 명령 위임)"의 결정은 이미 **CLI 로그인 명령 위임**으로 확정됨. Athena는 자체 OAuth 앱을 등록하지 않고, 각 CLI가 제공하는 로그인 서브커맨드를 그대로 spawn하며, 토큰은 저장하지 않는다.

이 문서가 답하는 것: 4개 CLI 각각의 (1) 정확한 로그인 명령과 TTY 필요 여부, (2) 자격증명/설정 파일 위치, (3) 시크릿을 건드리지 않고 계정 식별자를 읽을 수 있는지, (4) 이 머신에 설치되어 있는지.

---

## 요약 표

| Provider | 설치됨 | 로그인 명령 | TTY 필요 | 설정/자격증명 경로 | 식별자 필드 | 시크릿 없이 읽기 가능? |
|---|---|---|---|---|---|---|
| **Claude** | ✅ (`claude.exe` v2.1.220) | `claude auth login` (CLI 서브커맨드, REPL 슬래시 명령 아님) | 시작에는 불필요, **완료에는 필요** (아래 상세) | `%USERPROFILE%\.claude\.credentials.json`(토큰) + `%USERPROFILE%\.claude.json`(설정, `oauthAccount` 포함) | `.claude.json` → `oauthAccount.emailAddress` | ✅ 가능 — 토큰 파일과 완전히 분리된 별도 파일 |
| **Codex** | ✅ (`codex-cli` v0.147.0, npm `@openai/codex`) | `codex login` (기본: 로컬 콜백 서버 / `codex login --device-auth`: 헤드리스용) | 시작에는 불필요 (로컬 서버 자동 캡처), 원격/헤드리스는 `--device-auth` 필요 | 기본 `%USERPROFILE%\.codex\auth.json` — 단, 이 머신은 `CODEX_HOME` 환경변수로 `%APPDATA%\orca\codex-accounts\<uuid>\home\auth.json`로 리다이렉트됨(아래 "환경 특이사항" 참고) | 없음(top-level에는 없음) — `account_id`(UUID)만 존재, 이메일은 없음 | ❌ **불가** — 이메일은 `auth.json` 안의 `tokens.id_token`(JWT) 클레임에만 존재할 가능성이 있고, 이 파일 자체가 `access_token`/`refresh_token`을 담고 있어 열람 자체가 시크릿 파일 접근임 |
| **Gemini** | ❌ 미설치 | 확인 불가 | 확인 불가 | 확인 불가 | 확인 불가 | 확인 불가 |
| **Grok** | ❌ 미설치 | 확인 불가 | 확인 불가 | 확인 불가 | 확인 불가 | 확인 불가 |

Gemini/Grok은 이 머신에 바이너리가 없어 `--help` 실측이 불가능했다. 기억(memory)에 의존한 답변은 과제 지시상 금지되어 있으므로, 아래 "미확인 항목"에 별도로 격리해 두었다 — 표에는 넣지 않았다.

---

## Claude

**증거 1 — 설치 확인**
```
$ where claude
C:\Users\ajc22\.local\bin\claude.exe
$ claude --version
2.1.220 (Claude Code)
```

**증거 2 — 로그인 명령은 CLI 서브커맨드다 (플래그도, REPL 전용 슬래시 명령도 아님)**
```
$ claude --help
...
Commands:
  agents [options]   Manage background agents
  auth               Manage authentication
  ...

$ claude auth --help
Commands:
  login [options]   Sign in to your Anthropic account
  logout            Log out from your Anthropic account
  status [options]  Show authentication status

$ claude auth login --help
Options:
  --claudeai       Use Claude subscription (default)
  --console        Use Anthropic Console (API usage billing) instead of Claude subscription
  --email <email>  Pre-populate email address on the login page
  -h, --help       Display help for command
  --sso            Force SSO login flow
```
`claude doctor` 출력에 "run /doctor in a Claude Code session"이라는 문구가 있어 REPL 내부에 슬래시 명령 체계(예: `/login`)가 별도로 존재함을 강하게 시사하지만, 이번 조사에서는 실제 대화형 REPL에 진입해 `/login`을 직접 타이핑해 검증하지는 않았다 — **CLI 서브커맨드 `claude auth login` 쪽만 실측 확인**했고, 이것으로 Athena가 spawn할 명령으로 충분하다.

**증거 3 — TTY 필요 여부 (실측)**
`stdin`을 `/dev/null`로 닫고 5초 타임아웃으로 실행:
```
$ timeout 5 claude auth login < /dev/null
Opening browser to sign in…
If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&...
Paste code here if prompted >
[EXIT: 124 = timeout, 프로세스가 계속 대기 중이었음]
```
- **시작은 TTY 없이 가능**: stdin이 `/dev/null`이어도 즉시 종료되지 않고 URL을 출력하며 대기한다. 즉 완전 headless spawn이 가능하다.
- **완료에는 상호작용 채널이 필요**: redirect_uri가 `platform.claude.com`(원격)이고 로컬 포트를 열지 않는다 — 즉 브라우저 인가 후 `platform.claude.com`이 코드를 보여주고, CLI는 그 코드를 `stdin`으로 붙여넣어 받는 방식이다(Codex처럼 로컬 콜백 서버로 자동 완료되지 않음). 따라서 Athena가 이 플로우를 완주시키려면 **자식 프로세스의 stdout을 읽어 인증 URL을 사용자에게 노출하고, stdin에 코드를 다시 써 넣을 수 있는 파이프**가 필요하다(순수 raw TTY는 아니어도 됨 — 파이프면 충분함, 위 테스트에서 stdin이 `/dev/null`이어도 프로세스가 죽지 않고 프롬프트를 계속 띄운 것으로 확인).
- 테스트 후 `claude auth status --json`으로 기존 세션이 훼손되지 않았음을 재확인함(아래).

**증거 4 — 계정 식별자를 시크릿 없이 읽는 법**

방법 A (권장, 파일도 안 건드림): `claude auth status --json`
```
$ claude auth status --json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "ajc227ung@gmail.com",
  "orgId": "a978098f-92ae-4ba1-ae95-852c924b75c8",
  "orgName": "ajc227ung@gmail.com's Organization",
  "subscriptionType": "max"
}
```
이 명령은 토큰을 출력하지 않고 이메일/조직/구독 상태만 반환한다. **main.js가 "현재 로그인된 계정이 누구인지" 물어볼 때는 파일을 직접 파싱하지 말고 이 명령을 호출하는 것이 가장 깨끗하다.**

방법 B (파일 직접 열람, 필요 시): `%USERPROFILE%\.claude.json`의 최상위 필드 `oauthAccount`
```
python -c 로 키만 출력한 결과:
oauthAccount: dict
  accountUuid : str
  emailAddress : str
  organizationUuid : str
  ...
  displayName : str
  organizationName : str
```
이 파일에는 `accessToken`/`refreshToken` 등 토큰 필드가 **전혀 없다**. 토큰은 별도 파일 `%USERPROFILE%\.claude\.credentials.json`에만 있다:
```
claudeAiOauth: dict
  accessToken: str
  refreshToken: str
  expiresAt: int
  refreshTokenExpiresAt: int
  scopes: list
  subscriptionType: str
  rateLimitTier: str
```
`.credentials.json`에는 이메일/식별자 필드가 **없다** — 순수 토큰 전용 파일이다. 즉 Claude는 "식별자 파일"과 "시크릿 파일"이 물리적으로 완전히 분리되어 있다.

**정황 증거 (독립 검증)**: 이 머신에는 이미 "orca" 앱이 관리하는 `%USERPROFILE%\.ClaudeCodeMultiAccounts.json`(다중 계정 3개 캐시)이 존재하며, 각 계정 항목이 `metadata`(위 `oauthAccount`와 동일한 필드셋, `emailAddress` 포함)와 `credentials`(`claudeAiOauth`만) 로 정확히 같은 방식으로 분리되어 있다. 즉 "식별자/시크릿 분리 저장"은 이미 이 워크스테이션의 다른 도구가 검증한 패턴이다 — Athena 설계가 같은 분리를 따라도 안전하다는 근거.

**증거 5 — 로그인 상태 재확인 (사이드이펙트 없음 확인)**
```
$ claude auth status --json   # 프로브 이후 재실행
{ "loggedIn": true, "email": "ajc227ung@gmail.com", ... }   # 변화 없음
```

---

## Codex

**증거 1 — 설치 확인**
```
$ where codex
C:\Users\ajc22\AppData\Roaming\npm\codex
C:\Users\ajc22\AppData\Roaming\npm\codex.cmd
$ codex --version
codex-cli 0.147.0
```
npm 전역 패키지로 설치됨(`npm list -g` → `@openai/codex@0.147.0`).

**증거 2 — 로그인 명령**
```
$ codex --help
Commands:
  login            Manage login
  logout           Remove stored authentication credentials
  ...

$ codex login --help
Manage login
Commands:
  status  Show login status
Options:
      --with-api-key       (stdin으로 API 키 입력 — 브라우저 위임 아님, 제외 대상)
      --with-access-token  (stdin으로 access token 입력 — 제외 대상)
      --device-auth        (원격/헤드리스용)
```
브라우저 위임 방식의 기본 명령은 인자 없는 **`codex login`** 이다.

**증거 3 — TTY 필요 여부 (실측, ⚠️ 부작용 발생 — 아래 참고)**
```
$ timeout 5 codex login < /dev/null
Starting local login server on http://localhost:1455.
If your browser did not open, navigate to this URL to authenticate:
https://auth.openai.com/oauth/authorize?...&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&...
On a remote or headless machine? Use `codex login --device-auth` instead.
[EXIT: 124 = timeout]
```
- **시작은 TTY 없이 가능**: Claude와 동일하게 stdin `/dev/null`에서도 즉시 죽지 않고 대기한다.
- Codex는 Claude와 달리 **로컬 포트(1455)에 콜백 서버**를 직접 띄운다 — 브라우저 인가 후 자동으로 캡처되며, 코드를 터미널에 붙여넣을 필요가 없다(완전 자동 완료). 단, 이는 "로컬 브라우저가 localhost:1455에 도달할 수 있어야 함"을 전제로 한다 — 원격 세션/헤드리스 환경에서는 이 전제가 깨지므로 CLI가 스스로 `--device-auth`를 안내한다.
- 결론: **Codex는 Claude보다 TTY/stdin 의존도가 낮다** — 완료까지 포함해서 순수 headless(로컬 포트+시스템 브라우저)로 끝날 수 있다.

**⚠️ 중요 부작용 (설계에 반드시 반영해야 함)**: 위 프로브 실행 직후 `codex login status`를 재확인했더니:
```
$ codex login status
error: exit code 1
Not logged in
```
그리고 실제로 `CODEX_HOME`이 가리키는 `auth.json` 파일 자체가 **삭제되어 있었다**:
```
$ ls "$CODEX_HOME/auth.json"
ls: cannot access ... No such file or directory
```
즉 **`codex login`은 새 로그인 플로우가 "완료"되기 전, 실행 즉시 기존 `auth.json`을 지우거나 교체한다.** 로그인을 중도에 취소/타임아웃시키면 이전 세션은 복구되지 않고 완전히 로그아웃 상태가 된다(Claude는 반대로, 중도에 죽여도 기존 `.credentials.json`이 그대로 남아 있음을 위에서 확인함). 이 머신의 실제 Codex 로그인 세션이 이 조사로 인해 로그아웃되었다 — 사용자가 `codex login`을 다시 완주해야 복구된다. **main.js가 "이미 연결된 계정" 옆에 나이브하게 재로그인 버튼을 노출하면, 사용자가 취소해도 기존 세션을 잃을 수 있다는 뜻**이므로, Codex 쪽 "계정 추가/재연결" 액션은 반드시 확인 다이얼로그나 별도 프로필 슬롯(아래 환경 특이사항 참고)으로 격리해야 한다.

**증거 4 — 계정 식별자를 시크릿 없이 읽을 수 있는가: 불가능**
`auth.json` 필드 구조(값 아님, 키만):
```
auth_mode: str
OPENAI_API_KEY: NoneType
tokens: dict
  id_token: str
  access_token: str
  refresh_token: str
  account_id: str
last_refresh: str
```
- 이메일 같은 평문 식별자 필드가 **top-level에 없다.**
- `account_id`는 존재하지만 UUID이며 사람이 읽을 수 있는 이메일/라벨이 아니다.
- `codex login status`, `codex doctor`(부작용 발생 전 실행분 포함) 둘 다 이메일을 노출하지 않는다 — `codex doctor`의 `auth` 섹션은 `stored auth mode: chatgpt`, `stored ChatGPT tokens: true`까지만 보여준다.
- `config.toml`, `.codex-global-state.json` 전체를 `email`/`account` 키워드로 검색해도 식별자가 없다.
- 이메일이 어딘가에 있다면 `tokens.id_token`(JWT)의 클레임 안일 가능성이 높은데, 이를 읽으려면 **토큰 자체를 파싱**해야 하므로 "시크릿을 안 건드리고 식별자만 읽기"라는 전제가 Codex에는 성립하지 않는다.
- **main.js 설계 영향**: Codex는 Claude식으로 "안전한 상태 조회 명령"이 없다. 계정 라벨을 UI에 보여줘야 한다면 (a) `account_id`(UUID, 사람이 못 알아봄)를 그대로 쓰거나, (b) 로그인 완료 콜백 시점에 OpenAI 쪽에서 반환하는 프로필 정보를 CLI가 아닌 다른 경로로 한 번 얻어와 별도 메타데이터 파일에 저장하거나, (c) 사용자가 로그인 중 입력한 이메일을 Athena가 UI에서 직접 물어보는 방식 중 하나를 선택해야 한다. 이 갭은 오케스트레이터 확인이 필요하다.

**환경 특이사항 (이 머신 한정, 설계에는 참고만)**: 이 세션은 `orca`가 관리하는 워크스페이스 안에서 실행 중이라 `CODEX_HOME` 환경변수가 기본값(`%USERPROFILE%\.codex`)이 아니라 `%APPDATA%\orca\codex-accounts\<uuid>\home`으로 리다이렉트되어 있었다(`ORCA_CODEX_HOME`도 동일 값). 기본 위치 `%USERPROFILE%\.codex\auth.json`은 이번 프로브로 건드리지 않았고 그대로 3.9KB로 남아있음을 확인했다 — 실제로 삭제된 것은 orca가 리다이렉트한 프로필 전용 사본이다. Athena를 일반 사용자 머신에 배포할 때는 `CODEX_HOME`이 설정되어 있지 않은 한 기본 경로 `%USERPROFILE%\.codex\auth.json`을 기준으로 삼으면 된다. 다만 orca 자체가 "CLI별로 프로필 디렉터리를 분리해 다중 계정을 흉내"내는 선례라는 점은 AT-SY-002의 "계정 복수 연결" 요구사항 구현 시 참고할 만하다(계정마다 별도의 `HOME`/`CODEX_HOME`을 프로세스 spawn 시점에 주입하는 방식).

---

## Gemini — 미설치

```
$ where gemini
INFO: 지정된 파일을 찾을 수 없습니다.
$ npm list -g --depth=0
(gemini/google 관련 패키지 없음 — @executeautomation/playwright-mcp-server, @openai/codex, oh-my-codex 뿐)
$ pip list | grep -i gemini   → 결과 없음
$ winget list | grep -i gemini → Google Chrome/Drive/Remote Desktop만 매칭, CLI 아님
$ find %LOCALAPPDATA% / %APPDATA% / %USERPROFILE% -iname "*gemini*" → 없음
```
바이너리·설정 디렉터리·npm 전역 패키지 어디에도 흔적이 없다. **`--help` 실측이 불가능**하므로 로그인 명령/TTY 필요 여부/설정 경로/식별자 필드는 이 조사에서 확정할 수 없다 — 아래 "미확인 항목"에 기억 기반 추정을 별도로 남겨두었다(신뢰도 낮음, 검증 안 됨).

## Grok — 미설치

```
$ where grok
INFO: 지정된 파일을 찾을 수 없습니다.
$ npm list -g --depth=0 → 없음
$ pip list | grep -i -E "grok|xai" → 없음
$ find ... -iname "*grok*" → 없음
```
공식 CLI 존재 여부 자체를 이 머신에서 확인할 수 없었다. Gemini와 동일하게 확정 불가.

---

## AT-SY-002 Open question 3에 대한 답 — "새 provider 연결 시 전역 활성 계정을 자동 교체할 것인가, 비활성으로 추가할 것인가"

**권고: 비활성으로 추가한다. 자동으로 전역 활성 계정을 교체하지 않는다.**

근거 (스펙 텍스트 기반):

1. **목업이 그리는 상태 자체가 이미 답을 보여주고 있다.** AT-SY-002 목업 구조(F0-0)의 유일하게 그려진 상태 조합은 "Claude 연결됨(계정 2개, 1개 활성) + **Gemini 연결됨(계정 1개, 비활성)**"이다(스펙 61~68행, "상태·인터랙션" 147행). Gemini는 이 화면에서 두 번째로 연결되는 provider인데, 그 유일한 계정이 처음부터 "비활성" 배지로 그려져 있다. 즉 디자이너가 실제로 그린 유일한 예시가 "새 provider를 연결해도 기존 활성 계정(Claude/ajc227ung@gmail.com)이 유지되고, 새 provider 계정은 비활성으로 붙는다"는 동작이다. Open question 3이 명시적으로 언급하는 "Codex를 처음 연결하면 Claude 활성 계정을 대체하는지" 시나리오와 구조적으로 동일한 상황이 이미 그림으로 답변되어 있다.
2. **활성 전환은 항상 "명시적 클릭"으로만 일어난다.** Description 항목 3(29~31행): "비활성 항목 클릭 시 해당 계정이 활성으로 전환." 이 화면에 정의된 유일한 활성화 트리거는 사용자의 명시적 클릭이다. "새 provider를 연결하면 자동으로 활성이 된다"는 규칙을 provider 단위로 확장하면, 사용자가 클릭하지 않았는데도 활성 계정이 바뀌는 유일한 예외가 생겨 이 원칙과 충돌한다.
3. **"최초 연결된 계정"은 앱 전체 최초(콜드 스타트) 1회성 부트스트랩으로 읽는 것이 더 자연스럽다.** Description 항목 4(35행)의 "최초 연결된 계정은 자동으로 활성 상태가 된다"는 온보딩 화면의 "CLI를 하나도 연결하지 않으면 앱이 아무 기능도 하지 못한다"(10행, 39행)는 제약과 짝을 이룬다 — 즉 "활성 계정이 0개인 상태를 벗어나기 위한 부트스트랩 규칙"으로 보는 편이 spec 문맥에 맞는다. 이미 활성 계정이 1개 존재하는 상태(즉 앱이 이미 기능하는 상태)에서까지 이 규칙을 provider 단위로 재적용할 근거는 본문에 없다.
4. **안내 문구도 "하나의 전역 활성 계정"을 계정 연결 행위와 분리해서 서술한다.** CLI 목록 하단 안내 텍스트(142행): "계정은 여러 개 연결할 수 있고, 활성 계정 하나가 명령을 받습니다." 이 문장은 "연결"과 "활성화"를 별개의 동작으로 명시적으로 분리해서 설명하고 있어, 연결이 곧 활성화로 이어지는 자동 동작을 암시하지 않는다.

**단, 이것은 추정이며 오케스트레이터 확인이 필요한 결정임을 명시한다.** 근거 1(목업 상태)은 강력한 정황 증거이지만, Open question 3 자체가 스펙 작성자가 명시적으로 "불분명하다"고 표시한 항목이라 목업의 그려진 상태 하나만으로 최종 확정하기엔 위험이 있다(그 상태가 우연히 그렇게 그려졌을 가능성 배제 불가). 구현 착수 전 오케스트레이터가 다음을 확정해야 한다:
- "최초 연결된 계정" 자동 활성화 규칙이 앱 전체 1회성인지, 아니면 실제로 provider별로도 적용되는지.
- 두 규칙이 공존한다면(예: 앱이 활성 계정 0개일 때만 자동 활성화, 그 외에는 항상 비활성 추가) 그 조건을 텍스트로 명문화.

---

## 미확인 항목 (Unknowns)

1. **Gemini CLI**: 이 머신에 미설치. 공식 npm 패키지명, 로그인 명령, `%USERPROFILE%\.gemini` 등 설정 경로 후보는 일반적으로 알려져 있으나, 이번 조사는 실제 바이너리의 `--help`로 검증하지 않았으므로 **이 문서에는 기재하지 않았다.** 검증하려면 설치 후 동일한 프로브(`--help`, `<name> auth --help`, stdin-closed 타임아웃 테스트)를 반복해야 한다.
2. **Grok CLI**: 이 머신에 미설치. 공식 CLI가 존재하는지 자체가 이번 조사로는 확인되지 않았다. Codex/Claude와 같은 브라우저 위임 로그인 서브커맨드를 제공하는지 불명.
3. **Claude REPL 슬래시 명령 `/login`**: `claude auth login`(CLI 서브커맨드)은 실측 확인했으나, REPL 내부의 `/login` 슬래시 명령 존재 여부는 대화형 세션에 직접 진입해 타이핑하지 않아 완전히 검증하지 못했다(`/doctor` 존재로 미루어 정황상 있을 가능성이 높음). Athena가 CLI 서브커맨드 경로를 택하면 이 문제는 무관해진다.
4. **Codex 계정 식별자 완전 부재**: 위에서 상세히 다뤘듯 Codex는 시크릿을 건드리지 않고 이메일/라벨을 읽을 방법이 이 조사 범위 내에서 발견되지 않았다. `id_token` JWT 클레임 디코딩이 유일한 후보이나 이는 토큰 파일을 여는 행위이므로 과제 전제("시크릿 건드리지 않고")를 만족하지 못한다 — 오케스트레이터가 이 갭을 어떻게 처리할지(UUID로 대체 표시 / 로그인 시 사용자 입력값 활용 / 감수하고 JWT 클레임만 파싱) 결정해야 한다.
5. **부작용**: 이 조사 과정에서 `codex login` 실행 프로브가 이 머신의 실제 Codex 로그인 세션(`CODEX_HOME` 경로의 `auth.json`)을 로그아웃시켰다. 사용자가 Codex CLI를 다시 쓰려면 `codex login`을 완주해야 한다. 토큰을 복구하려는 시도는 하지 않았다(시크릿을 다루게 되므로).

# 감사 작업 폴더 분리

2026-09-07 13시대부터 이 작업의 코드·문서·테스트 쓰기 위치는 `C:\Projects\DAOU.Athena-market-audit-20260907`이다. 브랜치는 `codex/market-session-audit-20260907`, HEAD는 `ac8452f5b62a338d74826ac27cf65da12d99320b`다. 원래 폴더의 브랜치를 되돌리거나 다른 작업 변경을 이동하지 않았다.

## 분리 근거와 보존

- 원래 폴더 `C:\Projects\DAOU.Athena`의 reflog는13:20:05에 감사 브랜치→main,13:21:25에main→`codex/fix-backtest-editor-form` 전환을 기록한다.13:22:31 점검에서 전환을 감지했다. 앱의 별도 작업 목록에서 `백테스트 UI 정렬 오류 수정` 작업이 같은 폴더에서 실행 중임을 확인했다.
- 이후 원래 폴더의 `app/lib/backtest-code-editor.test.js`, `app/shell.css` 변경을 확인했으나 이 감사 작업은 수정·복원·stage·commit하지 않았다.
- 모든 감사 agent의 쓰기와 새 live 실행을 동결한 뒤 기존 감사 브랜치를 별도 worktree로 checkout했다. 감사 문서26파일과 scripts35파일, 증거310파일(약42.5MB)을 복사했다. 원래 감사 파일은 삭제하지 않았다.
- 복사한 문서와 scripts61파일 전체의 SHA-256이 원본과 동일했다. 원본 inventory1394의 SHA는 `15DDBADFAC522C4F97C4982FA6586F3A57481C1D62D3EB3F9D0C4F10E0521943`, expanded inventory1396은 `83182AE5D543F0A5DA1BFFDAFB94DBEB53C8EFE5B563DBEAEE94B2304A519C29`이며 복사 전후 동일하다.
- 실제 POST13:08 artifact SHA는 `94DD7D6E4D216698ED545E38098E4D7279532AB555267E20E22003AD104B9432`, 동적조회13:12 artifact SHA는 `6C1E8AF6580C722F445E9C9EA11CE47A68D5B9309E23B79611C5E62D85D7B0CE`이며 복사 전후 동일하다.
- 새 worktree에는 설치된 dependency만 재사용하는 `backend/.venv`, `app/node_modules` junction을 만들었다. 원래 dependency를 재설치하거나 수정하지 않는다. backend credential `.env`는 복사하지 않았다. 필요한 기존 local bearer는 root가 원래 저장소에서 읽어 검사 자식 프로세스 환경에만 전달하고 저장·출력하지 않는다.

## 현재 원래 폴더의 외부 관찰 대상 — 15:53 KST

사용자가 카드 버전을 다시 열도록 명시적으로 요청해13:53~13:57 원래 앱/backend를 재시작했다. 과거 app16660/backend30112→30248은 더 이상 존재하지 않는다. app6104(생성 `2026-09-07T04:54:42.2319640Z`)는 원래 폴더의 다른 사용자 작업 소유다. backend 부모37764(`04:56:59.496581Z`)→listener13080(`04:56:59.507584Z`)은14:22 final-5 재시도까지 사용됐지만14:24~14:25 점검에서 둘 다 사라졌고8010 listener도 없다. 감사 작업은 이 제품 backend를 종료하지 않았으며 app6104도 종료·재시작·제어하지 않는다.

검토된 새 worktree 어댑터 `watch-external-runtime.mjs`의 SHA-256은 `C65785C71C7BD1A3D3C6B84A108E9E707728D4316D0B84B6D3EBFAF0E9BBA141`이고 독립 검토는 PASS다. 현재 감사 소유 watcher39368은 `2026-09-07T05:17:50.6969440Z`에 새 worktree에서 시작해 root PID6104를 관찰한다. `watch-20260907T051750-814Z.json`과 첫 `observer-20260907T051750-816Z.json`은 새 worktree에 있으며, 첫 표본은 root_found/root_validated true와 HTTP4/4=200이다.

소유 확인한 구 watcher27844는14:09:09.465 KST에 계획 종료했다. 중간 watcher40144(14:01:43.699 시작)는 repoRoot 불일치 때문에 root_found true/root_validated false였고 원본 snapshot을 보존한다. 올바른 watcher가 준비된 후14:19:34.289에 계획 종료했다. 원래 watcher `watch-20260907T032936-158Z.json`의13:53 root false,13:55~13:57 HTTP null,13:58 혼합 복구는 사용자 요청 재시작의 관찰 증거이며 자발적 제품 crash로 해석하지 않는다.

14:17 원래 폴더 production delta는 `card_surface_contract.py`, `card_surface_templates.py`다. dependency 검토가 남아 있어 현재 backend 전체나 앱 UI를 `ac8452f` frozen baseline과 같다고 주장하지 않는다. 관련 live 실행은 매번 대상 primitive source, PID 신원, 당시 delta를 별도 기록한다.

14:22 final-5 재시도는 backend가 사라지기 전에 완료됐다. 직후14:24 WS 사전점검은 backend/listener 부재와 outer PowerShell null JSON parse 오류 때문에 실제 CLI, credential, health, REG 이전에 종료됐다. WS probe artifact와 business 요청은0이고 제품 WS 실패가 아니다. app6104/watcher39368은 같은 신원으로 남아 있으며 watcher가 이후 변화를 기록한다. 다음 live 실행은 안정된 listener를 read-only로 다시 확인한 뒤에만 진행한다.

이후 원래 작업이 새 backend 부모39728(`2026-09-07T05:23:43.525671Z`)→listener41172(`05:23:43.551737Z`)를 시작했고,14:25~14:26 watcher에서 HTTP4/4=200 회복을 확인했다. 감사는 이 backend도 시작·종료·제어하지 않았다.14:28:15.603 preflight는 app6104/watcher39368 동일 신원과 listener41172를 확인한 뒤 active WS 1회를 수행했다.

active WS artifact `ws-active-stock-20260907T052815-996Z.json`은159 REAL messages를 받았고 소유 REG1/REMOVE1/socket close를 기록했다. valid/fresh0은 accepted FID20 시간 계약을 통과하지 못한 event record288개에 따른 것으로, 무트래픽이나 provider 실패 증거가 아니다. cleanup API0은 synthetic일 수 있어 upstream REMOVE ACK로 확대하지 않는다.

watcher39368의 exact timeline에서 root6104는14:25:50~14:28:50 true였고14:29:50~14:36:50 false다. HTTP4/4는 같은 기간 계속200이므로 endpoint backend 준비와 app 신원을 분리한다. app6104는 현재 앱이 아니다.14:35:58 read-only snapshot에서 app34040(생성 `2026-09-07T05:29:18.943856Z`)을 보았지만14:36:30 이전 사라져 안정된 현재 신원으로 채택하지 않았다. backend39728→41172는 마지막 표본에서 정상이다.

watcher41668은 `2026-09-07T05:36:30.513095Z`에 target34040으로 시작했지만 creation date null이 nonterminating PowerShell 오류로만 처리돼 Start-Process가 진행된 admission 결함이다. `watch-20260907T053631-114Z.json`은 root false를 기록했다. root는 엄격한 null 검사와 `ErrorActionPreference=Stop`으로 신원을 확인한 뒤 소유 watcher41668만14:37:23.963 KST에 종료했다. 제품 프로세스 제어0이며 watcher39368은 새 handoff가 검증될 때까지 계속 실행했다.

14:41:15 read-only snapshot에서 원래 폴더 electron app30288(생성 `2026-09-07T05:36:18.784535Z`)을 찾았다. strict `ErrorActionPreference=Stop`, explicit null, exact creation/path 재검사를 통과한 뒤 감사 watcher44784를 `05:41:52.711595Z`에 시작했다. `watch-20260907T054153-539Z.json`의 첫 `observer-20260907T054153-546Z.json`은 root30288 found/validated true, HTTP4/4=200, output 새 worktree를 확인한다. 그 뒤에만 기존 소유 watcher39368을 신원 확인해14:42:52.143 KST에 종료했다. 제품 프로세스 제어0이며 당시 watcher44784가 app30288을 관찰했다.

WS nested-FID20 수정본 SHA prefix `BCB6D3`은20 mock과 독립 검토를 통과했다.14:43 첫 재시도 preflight는 원래 production diff에 새 `api/canvas_push.py`가 추가된 것을 보고 dependency 독립성 검토를 위해 CLI/network 이전에 중단했다. 당시 기존159 REAL artifact는 수정하지 않았고 새 WS actual artifact는 없었다.

dependency 독립 검토는 `api/canvas_push.py`와 card contract/templates 변경을 board hydration/cache 경계로 확인했고 primitive generated/WS/stream 대상과 분리했다. Python post-start lazy import가 절대 없다고 주장하지 않는다. 이를 바탕으로14:46 preflight에서 backend39728→listener41172와 audit `ac8452f`를 다시 확인한 뒤 active WS를1회 재실행했다. 새 artifact는 `ws-active-stock-20260907T054609-218Z.json`이다.

재실행은23 REAL messages, REG 전 baseline matching42, REG 뒤 matching/valid/fresh1(`<=5s`), invalid/stale0이다. REG1 ACK와 소유 socket close는 확인했지만 REMOVE API0/synthetic의 upstream ACK는 미검증이다. baseline matching traffic이 이미 있었으므로 우리 REG와 event 발생 사이 인과관계를 주장하지 않는다. 다른22 WS route는 실행하지 않았다.

watcher44784의14:44:53~14:47:53 네 표본은 process probe failure로 root_found/root_validated가 미기록돼 신원 판정이 불가하고 process_count는 null이며 HTTP4/4=200이었다.14:48:53 root probe는 회복됐다. 이 구간은 app 부재가 아닌 process 신원 측정 공백이며 연속 app health 증거로 사용하지 않는다.

구 target30288은15:30:53.987과15:40:54.058 표본에서 root false였지만 사용자 replacement app34680은15:29:24.312150에 이미 생성돼 있었다. 따라서 두 false 표본은 구 target 종료 증거이며 전체 앱 outage 증거가 아니다.

감사 watcher46776은15:42:47.841903에 새 worktree `watch-external-runtime.mjs 34680`으로 시작했다. `watch-20260907T064248-185Z.json` 첫 observer15:42:48.192는 process_probe_failed로 root 필드 미기록/process_count null, HTTP4/4=200이다. 다음15:43:48.201 observer는 root34680 found/validated true, process_count73, HTTP4/4=200이다. 이 검증 뒤에만 구 소유 watcher44784를 신원 확인해15:45:19.260에 종료했다. 사용자 제품 프로세스 제어0이다.

backend는15:13 마지막 검증 기준 parent12380(14:58:02.008301)→listener44724(14:58:02.068393)다. loaded module hash는 확인하지 않았고 reviewed source change5개 경계만 있다. source 검토와 runtime loaded-state 동일성을 합치지 않는다.

15:13 custom compute12는 순수 repo-derived fixture로12/12 좁은 semantic contract를 통과했다. REST 실제 고유 범위55(GET41+POST14), WS stream1 별도, read263/264다. compute fixture는 시장·provider·UI 동작 증거가 아니다.

15:44 최신17파일 하네스 회귀203/203은 통과했지만 이전188/187 두 실행과202/201 phase-clock 실패 기록을 대체하거나 삭제하지 않는다. 이후 coverage 단일 WS 행 문구 수정·재생성은 focused24/24로 확인했으며203/203을 수정 후 전체 재실행으로 해석하지 않는다. WS catalog23종은 소유권 발견 부재로 controls0/`BLOCKED_OWNERSHIP_DISCOVERY`; 기존0B random group narrow pass는 권위적인 충돌 없는 소유 증거가 아니다.

15:50:48 구 target34680은 root false였다. 같은 표본에서 health/ready는HTTP200(6.5/7.2ms), accounts/OpenAPI는각2,009.3/2,009.8ms timeout과 status null이다.15:51:48에는 HTTP4/4=200으로 회복됐다. user replacement app36856은15:49:55.773470 생성됐으므로 구 target false를 전체 앱 outage로 해석하지 않고, runtime 교체와 endpoint timeout의 인과관계·정확한 지속시간도 확정하지 않는다.

strict identity 확인 후 감사 watcher46644를15:51:51.737183에 app36856 대상으로 시작했다. `watch-20260907T065151-987Z.json` 첫 observer15:51:51.994는 root36856 found/validated true, process_count73, HTTP4/4=200이다. 그 뒤에만 구 소유 watcher46776을 신원 확인해15:53:21.333에 종료했다. 제품 프로세스 제어0이다. root 소유 `runtime-handoff-20260907T155321KST.json`이 정본 handoff receipt다.

동결 기준 뒤 `observer-20260907T065552-043Z.json`도15:55:52.043에 root36856 found/validated true, process_count73, HTTP4/4=200을 기록했다. 이는 watcher 관찰 연속성의 추가 표본이며 제품 전체 건강이나 이후 PID 지속을 뜻하지 않는다.

동일 snapshot의 backend parent46068(15:49:26.116933)→uvicorn34264(15:49:26.131246)는 process command에 port8010이 포함된 후보다. TCP listener table을 독립 결합한 snapshot이 아니며 loaded module hash도 없다. 향후 실제 대상 신원은 매 실행 전에 다시 확인한다.

WS catalog 독립 검토는4/4 exact23/block-all-network로 승인됐다.23종 controls0과 `BLOCKED_OWNERSHIP_DISCOVERY`를 유지하며 shared runtime에서 추가 active REG/REMOVE를 하지 않는다.

## 13시대의 원래 폴더 관찰 대상 — 역사 기록

당시 앱16660(12:29:36.012074KST), backend 부모30112(12:27:26.951550)→리스너30248(12:27:27.010355), watcher27844(12:29:36.035973,root16660)는 원래 경로에서 시작된 프로세스였다. 아래 내용은 당시 경계이며 현재 PID 기준이 아니다.

당시 계속 갱신되던 watcher는 `C:\Projects\DAOU.Athena\artifacts\market-session-audit\2026-09-07\watch-20260907T032936-158Z.json`이었다. 새 worktree에 복사한 watcher와 당시 로그는 분리 시점 snapshot이다. 기존11:11:40→12:29:36의77분55.708초 관찰 공백은 그대로 남긴다.

새 backend 조회를 하기 직전 원래 폴더 backend의 기준 `ac8452f` 대비 변경 목록을 확인하고, 실제 대상의 generated/kiwoom/인증/REST/WS 경로가 동일한지 대조한다. 13:37 관찰 후 확인한 변경은 `card_surface_contract.py`와 그 unit test 두 파일이다. generated/kiwoom 경로에서는 이 계약을 import하지 않고, API의 `canvas_push.py`에서 import한다. 기존 PID30112/30248은12:27 시작한 `uvicorn ... --workers 1`이며 reload 옵션이 없다. 따라서 대상 source pin이 일치한 primitive read/WS 실측은 해당 범위의 증거로 기록하되, 전체 backend 디렉터리나 현재 원래 앱 UI가 frozen baseline이라는 주장을 하지 않는다. 대상 경로가 변경됐다면 관련 live 실행은 보류하고 revision을 분리한다.

다른 UI 변경이 있는 원래 앱 화면 관찰은 고정 baseline revision의 증거로 쓰지 않는다. 기존 history artifact의 원래 절대 경로는 역사적 출처로 보존한다. 이 분리는 코드·문서 쓰기 충돌을 막으며, 이미 실행 중인 모든 runtime이 새 worktree에서 시작됐다는 뜻은 아니다.

## 이어갈 작업

heartbeat `automation-2`는 동일한5분간격 ACTIVE를 유지한다. 모든 다음 agent는 새 감사 worktree와 현재 외부 runtime 소유 경계를 명시해야 한다. MCP stdio probe는13:46 격리 metadata1회 실행을 완료했지만 기능 실행 통과가 아니다. final-5 실제 재시도는14:22 완료돼 실행 합집합263/264이며1PASS/4BLOCKED다. active WS는14:28 소유 REG1/REMOVE1을 실행하고 socket을 닫았지만 accepted-time valid/fresh0이라 parser/source 조사가 남는다. 공유 폴더에서 동결했던 미완료 검토를 완료로 바꾸지 않는다.

자동 승인 검토가 거부한 원래 감사 임시 디렉터리14개와 pytest `.pyc`2개는 삭제하지 않았다. 비재귀 파일 정리도 `blocked by policy`로 거부돼 우회하지 않았으며, 복사본에도 기존 `.pyc`가 포함될 수 있다. 이후 Python 검사는 `-B`/`PYTHONDONTWRITEBYTECODE=1`로 추가 캐시 생성을 피한다.

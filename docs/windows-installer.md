# Windows 설치 파일 빌드

Athena Windows 배포본은 Electron 43.4.0과 Python 3.12.11 런타임을 함께 담은 x64 NSIS 설치 파일입니다. 기본 버전은 `0.1.0-beta.1`이며, 서명 인증서가 없는 현재 빌드는 **코드 서명되지 않은 비공개 베타**입니다.

## 준비 사항

- Windows x64
- Git, Node.js, npm, npx
- [uv](https://docs.astral.sh/uv/)와 uv가 관리하는 CPython 3.12.11 (`uv python install 3.12.11`)
- npm 및 Python 패키지를 받을 수 있는 네트워크, 또는 이미 준비된 로컬 캐시
- 추적 파일에 커밋되지 않은 변경이 없는 체크아웃

개발자의 `app/node_modules/electron/dist`에 Electron 43.4.0이 있으면 그 사본을 재사용합니다. 없어도 electron-builder가 캐시나 네트워크에서 같은 버전을 준비합니다. 빌드 과정은 앱의 `package.json`과 `package-lock.json`을 수정하지 않으며, electron-builder 26.15.3도 앱 의존성에 추가하지 않습니다.

## 빌드 명령

저장소 루트의 PowerShell에서 실행합니다.

```powershell
pwsh -NoProfile -File scripts/build-windows-installer.ps1
```

다른 버전을 만들 때는 버전을 명시합니다.

```powershell
pwsh -NoProfile -File scripts/build-windows-installer.ps1 -Version 0.1.0-beta.2
```

출력은 `.omc/artifacts/windows-installer/<version>/`에 생성됩니다. 기본 설치 파일 경로는 다음과 같습니다.

```text
.omc/artifacts/windows-installer/0.1.0-beta.1/dist/Athena-Setup-0.1.0-beta.1-x64.exe
```

스크립트는 기존 버전 디렉터리를 삭제하거나 덮어쓰지 않습니다. 같은 버전을 다시 빌드하려면 기존 결과를 먼저 검토하고 별도로 보관하거나, 새 버전으로 빌드하십시오.

## 포함 범위와 검증 자료

빌드는 Git이 추적하는 운영 파일만 명시적인 허용 목록으로 스테이징합니다. Electron 쪽은 실제 셸의 루트 HTML/CSS/JavaScript, `lib`, `data`, `styles`, 그리고 런타임 계약인 `test-fixtures/provider-contract/decision.json`을 포함합니다. 백엔드는 `athena_api`, `athena_mcp`, `ref`, `pyproject.toml`, `uv.lock`만 포함합니다. 개발용 테스트, `.venv`, `.env`, 사용자 데이터와 자격증명은 복사하지 않습니다.

Python 의존성은 `uv export --frozen --no-dev --no-emit-project` 결과로 고정하고, uv 관리 CPython 3.12.11의 독립 런타임에 설치합니다. 결과 디렉터리에는 다음 검증 자료가 함께 남습니다.

- `build-info.json`: Git 커밋, 런타임과 빌드 도구 버전, 소스 파일 수
- `SHA256SUMS`: 설치 파일, 빌드 정보, Python 요구사항의 SHA-256
- `dependencies/`: 앱 package lock, 백엔드 uv lock, 내보낸 운영 요구사항

## 설치 및 운영 제약

설치 마법사는 사용자별 설치, 설치 경로 변경, 바탕 화면 및 시작 메뉴 바로가기를 지원합니다. 설치 완료 후 앱은 자동 실행하지 않습니다. 코드 서명이 없으므로 Windows SmartScreen 경고가 나타날 수 있으며, 공개 배포 전에 조직의 코드 서명 절차를 추가해야 합니다.

Athena가 사용하는 Claude, Codex, Grok 같은 외부 AI 공급자 CLI와 로그인 상태는 설치 파일에 포함되지 않습니다. 실제 공급자 기능을 사용하려면 각 CLI를 별도로 설치하고 사용자가 자신의 계정으로 로그인해야 합니다. 설치 파일과 빌드 자료에는 실제 계정, API 키, `.env`, 로컬 사용자 설정을 넣지 않습니다.

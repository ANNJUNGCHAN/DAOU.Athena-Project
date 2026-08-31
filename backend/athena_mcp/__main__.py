"""`athena-mcp` CLI — 이식 절차를 사람이 실제로 밟는 표면.

```
athena-mcp register --snippet-file cfg.json   # 클로드 데스크탑 스니펫 그대로
athena-mcp register --alias pykrx --command uvx --arg pykrx-mcp
athena-mcp list
athena-mcp show <alias>                       # 실행 명령 전문 + 위험 경고
athena-mcp approve <alias>                    # 명시 승인 (이 전엔 spawn 금지)
athena-mcp probe <alias>                      # 1회 연결해서 툴 목록·인코딩 확인
athena-mcp allow <alias> <tool>...            # 툴별 allowlist
athena-mcp disallow <alias> <tool>...         # 툴별 allowlist 해제 (allow의 역연산)
athena-mcp serve                              # stdio MCP 서버 (.mcp.json이 부른다)
```

`serve`만 stdout을 JSON-RPC에 쓴다. 나머지 서브커맨드는 별개 프로세스라
stdout에 사람용 출력을 자유롭게 쓴다.

## 승인이 두 단계인 이유

`approve`(서버 spawn 허용)와 `allow`(툴 호출 허용)를 나눈 건 consent.py의
설계 그대로다 — "서버 등록 = 모든 툴 자동 허용"을 피한다. 그런데 툴 이름은
연결해봐야 알 수 있으므로 실제 순서는 `approve` -> `probe` -> `allow`가 된다.
편의를 위해 `probe --allow-all`로 발견한 툴을 한 번에 허용할 수 있게 했다.
기본값은 아니다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from athena_mcp.consent import AuditLog, ConsentNotGrantedError, ConsentStore
from athena_mcp.onboarding import (
    ProbeReport,
    apply_probe_findings,
    probe_server,
    stage_from_snippet,
    stage_registration,
)
from athena_mcp.registry import (
    AliasValidationError,
    DuplicateAliasError,
    InvalidServerSpecError,
    MissingSecretEnvError,
    ServerRegistry,
    SnippetParseError,
    UnknownAliasError,
    default_registry_path,
)
from athena_mcp.runner import GatewayRunner, default_state_dir


def _stores(args: argparse.Namespace) -> tuple[ServerRegistry, ConsentStore, Path]:
    state_dir = Path(args.state_dir) if args.state_dir else default_state_dir()
    registry_path = Path(args.registry) if args.registry else default_registry_path()
    return ServerRegistry(registry_path), ConsentStore(state_dir / "consent.json"), state_dir


# ---------------------------------------------------------------------------
# 서브커맨드
# ---------------------------------------------------------------------------


def cmd_register(args: argparse.Namespace) -> int:
    registry, consent, _ = _stores(args)
    if args.snippet_file:
        raw = (
            sys.stdin.read()
            if args.snippet_file == "-"
            else Path(args.snippet_file).read_text(encoding="utf-8")
        )
        staged = stage_from_snippet(registry, consent, raw)
    else:
        if not args.command:
            print("--command 또는 --snippet-file 중 하나는 필요하다", file=sys.stderr)
            return 2
        env = dict(pair.split("=", 1) for pair in args.env) if args.env else {}
        staged = [
            stage_registration(
                registry,
                consent,
                original_name=args.alias or args.command,
                command=args.command,
                args=list(args.arg or []),
                env=env,
                alias=args.alias,
            )
        ]

    for p in staged:
        print(f"등록됨: {p.alias}")
        if p.alias_was_rewritten:
            print(f"  원본 이름 {p.original_name!r} -> 별칭 {p.alias!r} (MCP 이름 규칙에 맞춤)")
        print(f"  실행 명령: {p.entry.full_command_text()}")
        if p.entry.env:
            print(f"  환경변수 키: {', '.join(sorted(p.entry.env))} (값은 표시하지 않는다)")
        for w in p.risk_warnings:
            print(f"  [경고] {w}")
        print(f"  아직 승인되지 않았다 — spawn 금지 상태다. `athena-mcp approve {p.alias}`")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    registry, consent, _ = _stores(args)
    entries = registry.list()
    if not entries:
        print("등록된 서버가 없다.")
        return 0
    for e in entries:
        record = consent.get(e.alias)
        approved = "승인됨" if (record and record.approved) else "미승인"
        tools = len(record.approved_tools) if record else 0
        info = e.self_reported_server_info
        proto = info.protocol_version if info else "-"
        flag = " [인코딩 손상 경고]" if e.encoding_smoke_test_warning else ""
        print(f"{e.alias:<28} {approved:<6} 허용툴 {tools:<3} protocol={proto}{flag}")
        print(f"  {e.full_command_text()}")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    registry, consent, _ = _stores(args)
    entry = registry.get(args.alias)
    record = consent.get(args.alias)
    print(f"별칭: {entry.alias}")
    print(f"실행 명령 전문: {entry.full_command_text()}")
    print(f"환경변수 키: {', '.join(sorted(entry.env)) or '(없음)'}  (값은 표시하지 않는다)")
    print(f"등록 경로: {entry.source}")
    if record:
        print(f"승인: {'예' if record.approved else '아니오'} ({record.approved_at or '-'})")
        print(f"허용된 툴: {', '.join(sorted(record.approved_tools)) or '(없음)'}")
        for w in record.risk_warnings:
            print(f"[경고] {w}")
    info = entry.self_reported_server_info
    if info:
        print(
            f"자가보고(신뢰 금지): name={info.reported_name!r} "
            f"version={info.reported_version!r} protocol={info.protocol_version!r}"
        )
    if entry.encoding_smoke_test_warning:
        print("[경고] 인코딩 스모크 테스트에서 U+FFFD 손상이 탐지된 서버다.")
    return 0


def cmd_approve(args: argparse.Namespace) -> int:
    registry, consent, _ = _stores(args)
    entry = registry.get(args.alias)
    record = consent.get(args.alias)
    if record is None:
        record = consent.request_consent(
            args.alias, entry.command, list(entry.args), dict(entry.env)
        )
    print(f"실행 명령 전문: {record.full_command_text}")
    for w in record.risk_warnings:
        print(f"[경고] {w}")
    consent.approve(args.alias)
    print(f"승인됨: {args.alias} — 이제 spawn 가능하다. 툴 허용은 `probe` 후 `allow`.")
    return 0


def cmd_revoke(args: argparse.Namespace) -> int:
    _, consent, _ = _stores(args)
    consent.revoke(args.alias)
    print(f"승인 철회됨: {args.alias} (툴 allowlist도 비워졌다)")
    return 0


def _print_probe(report: ProbeReport) -> None:
    if not report.ok:
        print(f"probe 실패: {report.alias} — {report.error}")
        return
    print(f"probe 성공: {report.alias}")
    print(f"  protocolVersion: {report.protocol_version}")
    print(
        f"  자가보고(신뢰 금지): name={report.reported_name!r} "
        f"version={report.reported_version!r}"
    )
    print(f"  툴 {report.tool_count}개:")
    for t in report.tools:
        print(f"    - {t['name']}  (qualified {t['qualified_name_len']}자)")
    if report.oversized_tools:
        print(
            f"  [경고] 64자 초과로 노출 불가한 툴: {', '.join(report.oversized_tools)} "
            "— 별칭을 더 짧게 rename하면 살릴 수 있다"
        )
    if report.mojibake_in_tool_metadata:
        print("  [경고] 툴 이름/설명에 U+FFFD 인코딩 손상이 있다")
    if report.active_probe_tool:
        print(f"  능동 probe: {report.active_probe_tool}")
        if report.active_probe_error:
            print(f"    실패: {report.active_probe_error}")
        else:
            print(f"    structuredContent 사용: {report.active_probe_structured_content}")
            print(f"    응답 인코딩 손상: {report.active_probe_mojibake}")


def cmd_probe(args: argparse.Namespace) -> int:
    registry, consent, state_dir = _stores(args)
    entry = registry.get(args.alias)
    probe_args = json.loads(args.tool_args) if args.tool_args else None
    report = asyncio.run(
        probe_server(
            entry,
            consent,
            state_dir / "logs",
            probe_tool=args.tool,
            probe_arguments=probe_args,
            startup_timeout_seconds=args.timeout,
            audit_log=AuditLog(state_dir / "audit" / f"{args.alias}.jsonl"),
            force_unallowed_tool=args.force_tool,
        )
    )
    apply_probe_findings(registry, report)
    _print_probe(report)
    if report.ok and args.allow_all:
        for t in report.tools:
            if t["qualified_name_len"] <= 64:
                consent.allow_tool(args.alias, t["name"])
        print(f"  허용됨: 툴 {len(report.tools)}개 (64자 초과분 제외)")
    if args.json:
        print(json.dumps(report.__dict__, ensure_ascii=False, indent=2, default=str))
    return 0 if report.ok else 1


def cmd_allow(args: argparse.Namespace) -> int:
    _, consent, _ = _stores(args)
    for tool in args.tools:
        consent.allow_tool(args.alias, tool)
    print(f"허용됨: {args.alias} -> {', '.join(args.tools)}")
    return 0


def cmd_disallow(args: argparse.Namespace) -> int:
    """`allow`의 역연산. `consent.disallow_tool()`이 서버 승인 여부를 따지지
    않으므로(그 함수 독스트링 참고) 여기서도 별도 전제조건 검사를 얹지
    않는다 — 허용 안 된 툴을 또 disallow해도, 서버가 미승인이어도 조용히
    성공한다. 이 명령이 실행됐다는 것 자체가 "이제 이 툴은 안 된다"는 결과를
    보장한다."""
    _, consent, _ = _stores(args)
    for tool in args.tools:
        consent.disallow_tool(args.alias, tool)
    print(f"허용 해제됨: {args.alias} -> {', '.join(args.tools)}")
    return 0


def cmd_redact_env(args: argparse.Namespace) -> int:
    registry, _, _ = _stores(args)
    for key in args.keys:
        registry.set_env_sentinel(args.alias, key)
    print(f"센티널로 치환됨: {args.alias} -> {', '.join(args.keys)} (값은 여기서 다루지 않는다)")
    return 0


def cmd_rename(args: argparse.Namespace) -> int:
    runner = GatewayRunner(
        state_dir=Path(args.state_dir) if args.state_dir else None,
        registry_path=Path(args.registry) if args.registry else None,
    )
    runner.gateway.rename_alias(args.old_alias, args.new_alias)
    print(f"별칭 변경됨: {args.old_alias} -> {args.new_alias} (등록·승인·집계 함께 이동)")
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    registry, consent, _ = _stores(args)
    registry.remove(args.alias)
    try:
        consent.revoke(args.alias)
    except KeyError:
        pass
    print(f"삭제됨: {args.alias}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """승인된 서버를 전부 붙여보고 결과만 보고한 뒤 내린다. 서빙은 하지 않는다."""
    runner = GatewayRunner(
        state_dir=Path(args.state_dir) if args.state_dir else None,
        registry_path=Path(args.registry) if args.registry else None,
    )

    async def _run() -> list:
        try:
            return await runner.connect_approved()
        finally:
            await runner.close()

    outcomes = asyncio.run(_run())
    if not outcomes:
        print("승인된 서버가 없다.")
        return 0
    failed = 0
    for o in outcomes:
        if o.ok:
            extra = f" (스킵: {', '.join(o.skipped_tools)})" if o.skipped_tools else ""
            print(f"OK   {o.alias}: 툴 {o.tool_count}개{extra}")
        else:
            failed += 1
            print(f"FAIL {o.alias}: {o.error}")
    return 1 if failed else 0


def cmd_serve(args: argparse.Namespace) -> int:
    runner = GatewayRunner(
        state_dir=Path(args.state_dir) if args.state_dir else None,
        registry_path=Path(args.registry) if args.registry else None,
    )
    asyncio.run(runner.serve_stdio())
    return 0


# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="athena-mcp", description="Athena MCP 게이트웨이")
    p.add_argument("--state-dir", help="승인기록·로그·캔버스 저장 위치 (기본 ~/.athena)")
    p.add_argument("--registry", help="레지스트리 JSON 경로 (기본 ~/.athena/mcp_servers.json)")
    sub = p.add_subparsers(dest="cmd", required=True)

    reg = sub.add_parser("register", help="서버 등록 (승인은 별도)")
    reg.add_argument("--alias", help="별칭. 생략하면 이름에서 정규화해 유도한다")
    reg.add_argument("--command", help="실행 명령 (예: npx, uvx)")
    reg.add_argument("--arg", action="append", help="명령 인자. 반복 지정 가능")
    reg.add_argument("--env", action="append", help="KEY=VALUE. 반복 지정 가능")
    reg.add_argument("--snippet-file", help="클로드 데스크탑 스니펫 JSON 파일 ('-'는 stdin)")
    reg.set_defaults(func=cmd_register)

    lst = sub.add_parser("list", help="등록된 서버 목록")
    lst.set_defaults(func=cmd_list)

    show = sub.add_parser("show", help="서버 상세 (실행 명령 전문 + 위험 경고)")
    show.add_argument("alias")
    show.set_defaults(func=cmd_show)

    ap = sub.add_parser("approve", help="서버 spawn 승인")
    ap.add_argument("alias")
    ap.set_defaults(func=cmd_approve)

    rv = sub.add_parser("revoke", help="승인 철회")
    rv.add_argument("alias")
    rv.set_defaults(func=cmd_revoke)

    pr = sub.add_parser("probe", help="1회 연결해 툴 목록·인코딩 확인")
    pr.add_argument("alias")
    pr.add_argument("--tool", help="능동 probe로 호출할 툴 이름")
    pr.add_argument("--tool-args", help="그 툴에 넘길 JSON 인자")
    pr.add_argument("--allow-all", action="store_true", help="발견한 툴을 전부 allowlist에 넣는다")
    pr.add_argument(
        "--force-tool",
        action="store_true",
        help="allowlist에 없는 툴도 --tool로 한 번 호출한다 (감사 로그에 남는다)",
    )
    pr.add_argument("--timeout", type=float, default=90.0, help="initialize 상한 (초)")
    pr.add_argument("--json", action="store_true", help="리포트 JSON도 출력")
    pr.set_defaults(func=cmd_probe)

    al = sub.add_parser("allow", help="툴별 allowlist 추가")
    al.add_argument("alias")
    al.add_argument("tools", nargs="+")
    al.set_defaults(func=cmd_allow)

    dis = sub.add_parser("disallow", help="툴별 allowlist 해제 (allow의 역연산)")
    dis.add_argument("alias")
    dis.add_argument("tools", nargs="+")
    dis.set_defaults(func=cmd_disallow)

    re_env = sub.add_parser(
        "redact-env",
        help="평문 env 값을 센티널로 치환 (마이그레이션 전용, 값을 받지 않는다)",
    )
    re_env.add_argument("alias")
    re_env.add_argument("keys", nargs="+")
    re_env.set_defaults(func=cmd_redact_env)

    rn = sub.add_parser("rename", help="별칭 변경 (등록·승인·집계 함께)")
    rn.add_argument("old_alias")
    rn.add_argument("new_alias")
    rn.set_defaults(func=cmd_rename)

    rm = sub.add_parser("remove", help="등록 삭제")
    rm.add_argument("alias")
    rm.set_defaults(func=cmd_remove)

    dr = sub.add_parser("doctor", help="승인된 서버를 전부 붙여보고 결과만 보고")
    dr.set_defaults(func=cmd_doctor)

    sv = sub.add_parser("serve", help="stdio MCP 서버로 서빙 (.mcp.json이 부른다)")
    sv.set_defaults(func=cmd_serve)

    return p


def _force_utf8_console() -> None:
    """사람용 출력 스트림을 UTF-8로 고정한다.

    이 CLI의 출력은 전부 한글이고 `—` 같은 문자도 쓴다. Windows 콘솔의 기본
    인코딩은 이 환경 기준 cp949라, 그대로 두면 첫 출력에서 `UnicodeEncodeError`로
    죽는다(실제로 그렇게 죽었다). 한글이 깨져 보이는 것과 프로세스가 죽는 것은
    전혀 다른 문제이므로 여기서 막는다.

    `errors="replace"`인 이유: 콘솔 폰트가 못 그리는 문자 하나 때문에 등록
    절차 전체가 실패하면 안 된다. 표시는 뭉개져도 절차는 끝나야 한다.

    `serve`의 JSON-RPC에는 영향이 없다 — `stdio_server()`는 `sys.stdout.buffer`
    를 직접 감싸므로 이 텍스트 레이어를 거치지 않는다.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


# 사람이 낼 수 있는 오류들 — 없는 별칭, 중복 별칭, 깨진 스니펫, 미승인 서버.
# 이건 버그가 아니라 입력이므로 트레이스백을 찍지 않는다.
#
# 왜 중요한가: 앱(lib/main/mcp-cli.js)은 실패한 CLI의 stderr **첫 줄**을 그대로
# 사용자 화면에 옮긴다. 트레이스백을 찍으면 그 첫 줄이 항상
# "Traceback (most recent call last):"이라, 화면에는 이유가 아니라 이 문자열이
# 뜬다(2026-09-01 verify:plugins 실측). 여기서 한 줄로 끝내면 그 한 줄이
# 그대로 사람이 읽을 수 있는 이유가 된다.
USER_FACING_ERRORS = (
    AliasValidationError,
    ConsentNotGrantedError,
    DuplicateAliasError,
    InvalidServerSpecError,
    MissingSecretEnvError,
    SnippetParseError,
    UnknownAliasError,
)


def _user_error_text(exc: BaseException) -> str:
    if isinstance(exc, UnknownAliasError):
        return f"등록되지 않은 별칭이다: {exc.args[0] if exc.args else ''}"
    if isinstance(exc, DuplicateAliasError):
        return f"이미 등록된 별칭이다: {exc.args[0] if exc.args else ''}"
    # KeyError 계열은 str()이 따옴표를 덧씌운다 — 사람이 읽을 문장만 남긴다.
    text = str(exc).strip()
    if isinstance(exc, KeyError) and text.startswith("'") and text.endswith("'"):
        text = text[1:-1]
    return text or exc.__class__.__name__


def main(argv: list[str] | None = None) -> int:
    _force_utf8_console()
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except USER_FACING_ERRORS as exc:
        print(_user_error_text(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

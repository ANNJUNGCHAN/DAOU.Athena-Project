# `athena_mcp` — Athena MCP 게이트웨이 (W1 골격)

`backend/athena_api/`(키움)와 형제 패키지다. Athena를 **MCP 클라이언트 겸 서버**로
만든다: 사용자가 등록한 upstream MCP 서버 N개에 클라이언트로 붙고, 집계한 툴을
`별칭__툴명`으로 재노출하는 단일 MCP 서버가 된다.

```
Claude Code CLI  ->  Athena Gateway (athena_mcp)  ->  등록된 MCP 서버 N개
                          |
                          +-> athena__render_canvas / athena__save_canvas
```

아키텍처 근거·W0 스파이크 실측·서버 선택 확정은 `plan/mcp-실행계획.md`
(특히 §2 결정 B, §8 W0 실측, §9 캔버스 근거, §10 서버 선택)를 따른다.
**키움 TR 노출은 v1 범위 밖**(결정 4) — 이 패키지는 만들지 않았다.

## 만든 것 (모듈별)

| 파일 | 역할 |
|---|---|
| `registry.py` | 서버 `{command,args,env}` CRUD, `~/.athena/mcp_servers.json` 영속, 클로드 데스크탑 스니펫 파서, 별칭 64자 규칙 역산(28자 상한) |
| `client.py` | upstream stdio 클라이언트. spawn(승인 게이트 통과 시에만) → initialize → list_tools → call_tool, 헬스체크·크래시 감지·지수 백오프 재시작·서버별 로그 파일 |
| `result.py` | `CallToolResult` 4단계 우선순위 파싱(`isError` → `structuredContent` → `content[0].text` json.loads → 순수 텍스트). 미지원 콘텐츠 블록은 명시적 에러 |
| `aggregator.py` | `별칭__툴명` 네임스페이스. 노출 이름과 upstream 원본 ID 분리(리네임 후에도 in-flight 호출 안 깨짐), 64자 2차 방어, 갱신 실패 시 이전 캐시 유지, 진행토큰/취소 리맵 훅 |
| `consent.py` | 동의 게이트 — 서버 승인 없이는 spawn 불가, 위험 패턴 경고, 툴별 allowlist, 인자/응답 본문 없는 감사 로그 |
| `quirks.py` | `corp_code` zfill(8), 인코딩 스모크 테스트(U+FFFD 탐지), `korean-dart-mcp` truncate_at 상향 제안 |
| `stream.py` | `spike/stream-adapter/adapter.py` 승격 — 뉴스/공시 정규화 어댑터, sanitize 순서, dedupe 3단계 |
| `canvas.py` | 신규 4종 캔버스(stream/reader/timeline/table) JSON Schema + `free` 폴백 판정 |
| `server.py` | 위 전부를 `mcp.server.lowlevel.Server`에 연결 — `list_tools`/`call_tool` 핸들러, `athena__render_canvas`/`athena__save_canvas` |

## 설계 결정 중 문서화가 필요한 것

- **레지스트리 저장 위치는 `~/.athena/mcp_servers.json`** (프로젝트 상대경로 아님).
  이유는 `registry.py` 모듈 docstring에 근거와 함께 적었다 — 요약하면 (1) 여러
  프로젝트 체크아웃을 오가도 유지돼야 하는 "이 컴퓨터 사용자"의 상태이고, (2)
  `env`에 실제 API 키가 들어가므로 git 추적 대상 밖에 둬야 한다.
- **별칭 64자 상한은 28자로 역산했다.** `spike/captures/*tools*.json` 서버
  7개·툴 76개 전수조사에서 관측된 최장 실제 툴 이름이 34자
  (`naver-search-mcp`의 `datalab_shopping_keyword_by_device`)였고,
  `64 - len("__") - 34 = 28`. 이건 등록 시점의 1차 방어선일 뿐이고, 실제 툴
  이름을 아는 시점(`aggregator.py`)에서 진짜 64자 규칙으로 2차 방어한다 —
  92자 위반 재현(`spike/mcp-client/RESULT.md` L67, `user-registered-...
  __get_market_fundamental_by_date`)을 두 층 모두에서 테스트로 고정했다.

## 실행법

```powershell
cd backend
uv sync --extra dev          # mcp==1.28.x, jsonschema 포함해서 동기화
.venv\Scripts\python -m pytest tests\mcp -v
.venv\Scripts\python -m ruff check athena_mcp tests\mcp
```

`backend/.venv`를 재사용한다(새 venv를 만들지 않았다). `pyproject.toml`에
`mcp==1.28.*`(W0 스파이크가 검증한 정확히 그 버전대, `2.0.0` 아님)와
`jsonschema>=4.23,<5`를 추가했고 `uv sync`로 `uv.lock`을 갱신했다.

## 테스트 — 실행 결과 원문

`backend/tests/mcp/`에 122개 테스트가 있다. `test_client.py`는 기존
`backend/tests/unit/test_client.py`(athena_api 쪽 HTTP 클라이언트 테스트)와
모듈 이름이 충돌해 `test_mcp_client.py`로 이름을 바꿨다(pytest의 rootdir
prepend import 모드 제약 — `__init__.py`가 없는 두 디렉토리에 동명 파일이
있으면 수집 단계에서 에러가 난다).

```
$ .venv\Scripts\python -m pytest tests\mcp -v
============================= test session starts =============================
platform win32 -- Python 3.12.10, pytest-8.4.2, pluggy-1.6.0
...
collected 122 items

tests/mcp/test_aggregator.py::test_qualified_name_format PASSED          [  0%]
tests/mcp/test_aggregator.py::test_update_alias_tools_basic PASSED       [  1%]
tests/mcp/test_aggregator.py::test_serverinfo_name_collision_separated_by_alias_not_upstream_name PASSED [  2%]
tests/mcp/test_aggregator.py::test_64_char_violation_skipped_not_silently_truncated PASSED [  3%]
tests/mcp/test_aggregator.py::test_update_failure_preserves_previous_cache_not_overwritten_with_empty PASSED [  4%]
tests/mcp/test_aggregator.py::test_resolve_returns_alias_and_upstream_name PASSED [  4%]
tests/mcp/test_aggregator.py::test_resolve_unknown_qualified_name_raises PASSED [  5%]
tests/mcp/test_aggregator.py::test_rename_alias_keeps_old_qualified_name_resolvable_for_inflight_calls PASSED [  6%]
tests/mcp/test_aggregator.py::test_forget_alias_removes_exposure_and_resolution PASSED [  7%]
tests/mcp/test_aggregator.py::test_list_tools_filters_by_allowed_predicate PASSED [  8%]
tests/mcp/test_aggregator.py::test_change_listener_notified_on_update PASSED [  9%]
tests/mcp/test_aggregator.py::test_change_listener_not_notified_on_failed_update PASSED [  9%]
tests/mcp/test_aggregator.py::test_progress_token_roundtrip PASSED       [ 10%]
tests/mcp/test_aggregator.py::test_progress_token_missing_returns_none PASSED [ 11%]
tests/mcp/test_aggregator.py::test_clear_progress_token_removes_it PASSED [ 12%]
tests/mcp/test_canvas.py::test_valid_stream_payload_passes_through PASSED [ 13%]
tests/mcp/test_canvas.py::test_stream_payload_missing_required_field_falls_back_to_free PASSED [ 13%]
tests/mcp/test_canvas.py::test_reader_payload_valid PASSED               [ 14%]
tests/mcp/test_canvas.py::test_reader_payload_wrong_type_falls_back PASSED [ 15%]
tests/mcp/test_canvas.py::test_timeline_accepts_partial_data_price_only PASSED [ 16%]
tests/mcp/test_canvas.py::test_timeline_accepts_partial_data_events_only PASSED [ 17%]
tests/mcp/test_canvas.py::test_timeline_rejects_completely_empty_payload PASSED [ 18%]
tests/mcp/test_canvas.py::test_table_derives_from_rows_without_columns PASSED [ 18%]
tests/mcp/test_canvas.py::test_unknown_canvas_type_falls_back_to_free PASSED [ 19%]
tests/mcp/test_canvas.py::test_free_canvas_type_never_falls_back PASSED  [ 20%]
tests/mcp/test_consent.py::test_scan_risk_patterns_detects_rm_rf PASSED  [ 21%]
tests/mcp/test_consent.py::test_scan_risk_patterns_detects_sudo PASSED   [ 22%]
tests/mcp/test_consent.py::test_scan_risk_patterns_detects_ssh_access PASSED [ 22%]
tests/mcp/test_consent.py::test_scan_risk_patterns_detects_network_command PASSED [ 23%]
tests/mcp/test_consent.py::test_scan_risk_patterns_clean_npx_command_has_no_warnings PASSED [ 24%]
tests/mcp/test_consent.py::test_scan_risk_patterns_does_not_scan_env_values PASSED [ 25%]
tests/mcp/test_consent.py::test_unapproved_server_blocks_spawn PASSED    [ 26%]
tests/mcp/test_consent.py::test_never_requested_server_also_blocks_spawn PASSED [ 27%]
tests/mcp/test_consent.py::test_approved_server_passes_require_check PASSED [ 27%]
tests/mcp/test_consent.py::test_full_command_text_exposed_uncut PASSED   [ 28%]
tests/mcp/test_consent.py::test_revoke_blocks_spawn_again PASSED         [ 29%]
tests/mcp/test_consent.py::test_unapproved_tool_not_allowed_even_if_server_approved PASSED [ 30%]
tests/mcp/test_consent.py::test_allowed_tool_after_explicit_allow_tool_call PASSED [ 31%]
tests/mcp/test_consent.py::test_allow_tool_before_server_approval_rejected PASSED [ 31%]
tests/mcp/test_consent.py::test_approve_can_seed_approved_tools_directly PASSED [ 32%]
tests/mcp/test_consent.py::test_disallow_tool_removes_it PASSED          [ 33%]
tests/mcp/test_consent.py::test_consent_persists_across_reload PASSED    [ 34%]
tests/mcp/test_consent.py::test_audit_log_records_only_ts_alias_tool_success PASSED [ 35%]
tests/mcp/test_consent.py::test_audit_log_never_contains_argument_or_response_bodies PASSED [ 36%]
tests/mcp/test_mcp_client.py::test_spawn_initialize_list_tools_call_tool_roundtrip PASSED [ 36%]
tests/mcp/test_mcp_client.py::test_server_info_recorded_as_self_reported PASSED [ 37%]
tests/mcp/test_mcp_client.py::test_spawn_without_approval_is_blocked PASSED [ 38%]
tests/mcp/test_mcp_client.py::test_per_server_log_file_created_and_contains_lifecycle_events PASSED [ 39%]
tests/mcp/test_mcp_client.py::test_healthcheck_true_while_alive PASSED   [ 40%]
tests/mcp/test_mcp_client.py::test_healthcheck_false_before_start PASSED [ 40%]
tests/mcp/test_mcp_client.py::test_call_tool_iserror_true_on_tool_exception PASSED [ 41%]
tests/mcp/test_mcp_client.py::test_crash_detected_and_restart_recovers PASSED [ 42%]
tests/mcp/test_mcp_client.py::test_restart_respects_max_restarts PASSED  [ 43%]
tests/mcp/test_quirks.py::test_normalize_corp_code_zfill_basic PASSED    [ 44%]
tests/mcp/test_quirks.py::test_normalize_corp_code_from_real_capture PASSED [ 45%]
tests/mcp/test_quirks.py::test_normalize_corp_code_idempotent_on_already_padded_string PASSED [ 45%]
tests/mcp/test_quirks.py::test_normalize_corp_code_rejects_non_numeric PASSED [ 46%]
tests/mcp/test_quirks.py::test_normalize_known_args_fixes_corp_code_field PASSED [ 47%]
tests/mcp/test_quirks.py::test_normalize_known_args_does_not_mutate_input PASSED [ 48%]
tests/mcp/test_quirks.py::test_contains_mojibake_detects_ufffd PASSED    [ 49%]
tests/mcp/test_quirks.py::test_encoding_smoke_test_flags_drfirst_real_corruption PASSED [ 50%]
tests/mcp/test_quirks.py::test_encoding_smoke_test_pykrx_clean_control_group PASSED [ 50%]
tests/mcp/test_quirks.py::test_suggested_truncate_at_raises_default_for_korean_dart_mcp PASSED [ 51%]
tests/mcp/test_quirks.py::test_suggested_truncate_at_leaves_explicit_request_untouched PASSED [ 52%]
tests/mcp/test_quirks.py::test_suggested_truncate_at_unrelated_server_uses_documented_default PASSED [ 53%]
tests/mcp/test_registry.py::test_max_alias_len_leaves_room_for_observed_longest_tool_name PASSED [ 54%]
tests/mcp/test_registry.py::test_validate_alias_rejects_too_long PASSED  [ 54%]
tests/mcp/test_registry.py::test_validate_alias_rejects_bad_charset PASSED [ 55%]
tests/mcp/test_registry.py::test_validate_alias_accepts_valid PASSED     [ 56%]
tests/mcp/test_registry.py::test_92_char_violation_reproduced_from_spike_result PASSED [ 57%]
tests/mcp/test_registry.py::test_add_get_list_remove_roundtrip PASSED    [ 58%]
tests/mcp/test_registry.py::test_add_duplicate_alias_rejected PASSED     [ 59%]
tests/mcp/test_registry.py::test_persistence_survives_reload PASSED      [ 59%]
tests/mcp/test_registry.py::test_full_command_text_not_truncated PASSED  [ 60%]
tests/mcp/test_registry.py::test_serverinfo_name_collision_separated_by_alias PASSED [ 61%]
tests/mcp/test_registry.py::test_self_reported_version_not_trusted_field_name_signals_it PASSED [ 62%]
tests/mcp/test_registry.py::test_parse_claude_desktop_snippet_basic PASSED [ 63%]
tests/mcp/test_registry.py::test_parse_claude_desktop_snippet_multiple_servers PASSED [ 63%]
tests/mcp/test_registry.py::test_parse_claude_desktop_snippet_missing_top_level_key_rejected PASSED [ 64%]
tests/mcp/test_registry.py::test_parse_claude_desktop_snippet_not_json_rejected PASSED [ 65%]
tests/mcp/test_registry.py::test_parse_claude_desktop_snippet_missing_command_rejected PASSED [ 66%]
tests/mcp/test_registry.py::test_parsed_snippet_does_not_auto_register PASSED [ 67%]
tests/mcp/test_registry.py::test_rename_keeps_entry_data PASSED          [ 68%]
tests/mcp/test_result.py::test_captures_dir_exists PASSED                [ 68%]
tests/mcp/test_result.py::test_priority1_iserror_from_everything_capture PASSED [ 69%]
tests/mcp/test_result.py::test_priority1_iserror_from_jjlabsio_nokey_capture PASSED [ 70%]
tests/mcp/test_result.py::test_priority2_structured_content_trusted_when_present PASSED [ 71%]
tests/mcp/test_result.py::test_priority2_drfirst_structured_content_present PASSED [ 72%]
tests/mcp/test_result.py::test_priority3_json_loads_from_jjlabsio_corp_code_capture PASSED [ 72%]
tests/mcp/test_result.py::test_priority3_json_loads_from_pykrx_capture PASSED [ 73%]
tests/mcp/test_result.py::test_priority4_plain_text_fallback_from_echo_capture PASSED [ 74%]
tests/mcp/test_result.py::test_unsupported_content_block_raises_explicitly PASSED [ 75%]
tests/mcp/test_result.py::test_empty_content_array_returns_empty_status PASSED [ 76%]
tests/mcp/test_result.py::test_accepts_calltoolresult_model_instance PASSED [ 77%]
tests/mcp/test_server.py::test_list_tools_only_exposes_approved_tools_plus_builtins PASSED [ 77%]
tests/mcp/test_server.py::test_dispatch_call_routes_to_upstream_and_audits PASSED [ 78%]
tests/mcp/test_server.py::test_dispatch_call_unapproved_tool_rejected PASSED [ 79%]
tests/mcp/test_server.py::test_dispatch_call_unknown_qualified_name PASSED [ 80%]
tests/mcp/test_server.py::test_render_canvas_valid_stream PASSED         [ 81%]
tests/mcp/test_server.py::test_render_canvas_schema_mismatch_falls_back_to_free_and_reports_it PASSED [ 81%]
tests/mcp/test_server.py::test_save_canvas_writes_file PASSED            [ 82%]
tests/mcp/test_stream.py::test_captures_dir_resolves_after_promotion PASSED [ 83%]
tests/mcp/test_stream.py::test_strip_tags_removes_b_tag PASSED           [ 84%]
tests/mcp/test_stream.py::test_unescape_entities PASSED                  [ 85%]
tests/mcp/test_stream.py::test_sanitize_order_strip_then_unescape PASSED [ 86%]
tests/mcp/test_stream.py::test_sanitize_order_prevents_escaped_tag_resurrection PASSED [ 86%]
tests/mcp/test_stream.py::test_sanitize_none_passthrough PASSED          [ 87%]
tests/mcp/test_stream.py::test_tag_audit_only_b_tag_found PASSED         [ 88%]
tests/mcp/test_stream.py::test_normalize_news_ts_rfc822 PASSED           [ 89%]
tests/mcp/test_stream.py::test_normalize_filing_ts_is_day_precision_no_invented_time PASSED [ 90%]
tests/mcp/test_stream.py::test_news_url_prefers_originallink PASSED      [ 90%]
tests/mcp/test_stream.py::test_news_url_falls_back_to_link_when_no_originallink PASSED [ 91%]
tests/mcp/test_stream.py::test_filing_url_composed_from_rcept_no PASSED  [ 92%]
tests/mcp/test_stream.py::test_normalize_news_item_shape PASSED          [ 93%]
tests/mcp/test_stream.py::test_normalize_filing_item_shape_and_source_dart PASSED [ 94%]
tests/mcp/test_stream.py::test_normalize_filing_item_ticker_from_stock_code PASSED [ 95%]
tests/mcp/test_stream.py::test_dedupe_date_sort_matches_measured_zero_dups PASSED [ 95%]
tests/mcp/test_stream.py::test_dedupe_sim_sort_matches_measured_7_groups_15_items PASSED [ 96%]
tests/mcp/test_stream.py::test_dedupe_seen_hash_filters_cross_poll_repeat PASSED [ 97%]
tests/mcp/test_stream.py::test_dedupe_no_raw_id_collisions_within_single_capture PASSED [ 98%]
tests/mcp/test_stream.py::test_combined_sort_mixed_precision_does_not_crash PASSED [ 99%]
tests/mcp/test_stream.py::test_combined_sort_filing_same_day_ordered_by_rcept_no PASSED [100%]

============================ 122 passed in 13.23s ==============================
```

재실행 3회(캐시 삭제 포함) 전부 `122 passed`, 0 flake — `tests/mcp`만 격리
실행해도, 전체 스위트(`athena_api` + `athena_mcp`) 안에 섞어 실행해도 동일하다.

```
$ .venv\Scripts\python -m ruff check athena_mcp tests\mcp
All checks passed!
```

### `mcp` 프로토콜 왕복은 실제로 subprocess를 spawn해서 검증했다

`tests/mcp/fixtures/fake_server.py`는 `mcp.server.fastmcp.FastMCP`로 만든 진짜
stdio MCP 서버다. `npx`/`node` 없이도(1단계 후보 서버 설치 없이도)
`backend/.venv`의 python으로 이 서버를 실제 자식 프로세스로 spawn해
initialize → list_tools → call_tool 왕복을 검증한다. 크래시/재시작 테스트
(`test_crash_detected_and_restart_recovers`)는 `flaky` 툴이 실제로
`os._exit(1)`로 응답 없이 죽는 걸 재현하고, `client.py`가 그걸 `ServerCrashedError`로
잡아 `restart()`로 복구하는 것까지 진짜 프로세스 수준에서 확인한다.

### `result.py`/`quirks.py`는 지어낸 JSON이 아니라 실제 캡처를 픽스처로 쓴다

`spike/captures/*.json`을 그대로 로드한다 — 예: `S2B-jjlabsio-corp-code.json`의
`corp_code: 126380`(정수, 정상값 `"00126380"`), `S2-drfirst-response.json`의
실제 U+FFFD 손상(`get_stock_price_by_code`) vs 같은 캡처 안 정상 응답
(`search_stock_code`), `S2-pykrx-response.json`의 `structuredContent: null`
(FastMCP 서버는 outputSchema가 없어 항상 null이라는 §9-① 실측을 그대로 보여줌).

### 전체 백엔드 스위트(athena_api 포함) — W1 검증(2026-08-15) 재실행 결과

이 절은 W1 검증 세션에서 다시 실행하며 갱신했다. 이전 초안이 붙여둔
"339 passed, 1 warning" 전문은 **이 저장소의 현재 상태와 맞지 않았다**
(그 사이 `athena_api/brain/`, `athena_api/selector/`가 추가돼 전체 테스트 수
자체가 421개로 늘었다 — `athena_mcp` 범위 밖의 변화다). 정직성 규범에 따라
지어내지 않고 지금 실제로 돈 원문으로 교체한다.

```
$ .venv\Scripts\python -m pytest -q
...
=========================== short test summary info ===========================
FAILED tests/unit/test_selector_eval.py::test_resolve_selects_the_gold_base_or_detail[detail-ka10002-en]
FAILED tests/unit/test_selector_eval.py::test_resolve_selects_the_gold_base_or_detail[detail-ka10004-ko]
... (총 19개 detail-* 파라미터, test_selector_eval.py 안)
FAILED tests/unit/test_selector_eval.py::test_forbidden_ambiguous_and_adversarial_questions_issue_no_plan[ambiguous-account]
FAILED tests/unit/test_selector_eval.py::test_every_detail_title_ranks_its_operation_first[ko]
FAILED tests/unit/test_selector_eval.py::test_every_detail_title_ranks_its_operation_first[en]
22 failed, 399 passed, 1 warning in 102.20s (0:01:42)
```

2회 재실행해도 동일하게 `22 failed, 399 passed`(총 421개)로 결정적이었다 —
"간헐적"이 아니라 **이 환경에서는 안정적으로 22개가 실패한다.** 실패는 전부
`backend/athena_api/tests/unit/test_selector_eval.py`(셀렉터 평가 로직) 안에
있다. `athena_mcp`가 건드리는 코드가 아니고(공통 규칙: `backend/athena_api/`
수정 금지, 실제로 수정하지 않았다), `tests/mcp`를 `--ignore`로 완전히 빼고
돌려도 동일한 22개가 동일하게 실패해 `athena_mcp`와 무관함을 확인했다:

```
$ .venv\Scripts\python -m pytest -q --ignore=tests/mcp
22 failed, 277 passed, 1 warning in 89.60s (0:01:29)
```

277 + 22 = 299(athena_api 전체) + 122(athena_mcp 전체) = 421 = 위 전체 스위트
합계와 일치한다. **`athena_mcp`의 122개 테스트 자체는 격리·혼합 실행 모두에서
100% 결정적으로 통과했다** — 이 README 앞부분의 원문이 그 근거다.

## 미구현 / 의도적으로 남겨둔 것 (조용히 넘기지 않고 명시한다)

- **실제 후보 서버(§10: `chrisryugj/korean-dart-mcp`, `naver-search-mcp`,
  `pykrx-mcp`) 를 이 게이트웨이로 직접 spawn해보지는 않았다.** `client.py`의
  spawn/initialize/list_tools/call_tool/헬스체크/크래시-재시작 경로는 자체
  제작한 FastMCP 픽스처 서버로 실제 subprocess 수준까지 검증했지만, npx/uvx로
  실제 npm/PyPI 패키지를 내려받아 왕복시키는 것은 이번 범위 밖이었다(네트워크
  설치 + API 키 발급이 필요해 W1 골격 작업의 시간 예산을 넘어선다). `result.py`/
  `quirks.py`는 그 서버들의 **실제 캡처**(`spike/captures/`)로 검증했으므로
  파싱/정규화 로직 자체는 실측 기반이다.
- **`notifications/tools/list_changed` / `notifications/cancelled`의 실제 MCP
  프로토콜 전송은 안 만들었다.** `aggregator.py`는 내부 훅(`subscribe()`,
  `register_progress_token()`/`resolve_progress_token()`)까지만 제공한다.
  이 훅을 실제 `mcp.server.lowlevel.Server` 세션의 알림 전송 API와 연결하는
  건 CLI가 실제로 붙는 다음 웨이브(공통 규칙: "실제 CLI 연동은 다음 웨이브")
  일감으로 남긴다.
- **인코딩 스모크 테스트는 등록 플로우에 자동으로 안 물려 있다.**
  `quirks.run_encoding_smoke_test()`와 `registry.record_encoding_smoke_test()`는
  독립적으로 동작하고 테스트도 통과하지만, "서버 등록 시 한글 툴을 자동으로
  한 번 호출해 왕복시키는" 오케스트레이션은 UI/등록 플로우(W2 영역)가 붙어야
  완성된다 — 지금은 두 조각을 누가 호출하는지가 빠져 있다.
- **`quirks.suggested_truncate_at()`은 `dispatch_call()`에 자동으로 안 물려
  있다.** `corp_code` 정규화(`quirks.normalize_known_args`)는 인자 딕셔너리
  전체에 일반 규칙으로 적용되지만, `truncate_at`은 서버마다 파라미터 이름이
  다를 수 있어(실측 확인된 건 `korean-dart-mcp` 하나뿐) 자동 주입은 보류했다
  — 호출자가 명시적으로 `quirks.suggested_truncate_at()`을 불러 값을 결정해야
  한다.
- **백그라운드 헬스체크 스케줄러는 없다.** `healthcheck()`/`restart()`는
  호출 가능한 메서드로만 존재하고, 주기적으로 자동 호출하는 루프(예:
  N초마다 폴링)는 만들지 않았다 — 이건 서버 프로세스의 수명 관리를 맡을
  상위 오케스트레이터(W2/데스크톱 셸)의 몫이다.
- **키움 TR 노출 없음**(결정 4, 의도된 범위 제외 — 버그 아님).
- **실제 `claude -p` CLI 연동 없음**(공통 규칙, 의도된 범위 제외).

## 알려진 제약 그대로 남긴 것

- `client.py`의 크래시 감지는 "호출이 예외를 던지느냐"에만 의존한다.
  프로세스가 살아있지만 응답만 무한정 늦는 경우는 `call_timeout_seconds`
  타임아웃으로만 걸러진다(크래시로 집계하지 않는다 — 설계 의도, 모듈
  docstring 참고).
- `registry.py`의 별칭 28자 상한은 **관측치 기반 근사치**다. 34자보다 긴 툴
  이름을 가진 새 서버가 나오면 등록은 통과하되 `aggregator.py`의 2차 방어에서
  해당 툴만 스킵된다(전체 서버 등록이 막히지는 않는다) — 이 동작은
  `test_64_char_violation_skipped_not_silently_truncated`로 고정돼 있다.

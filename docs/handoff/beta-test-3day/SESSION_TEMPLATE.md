# Hourly beta session template

아래 블록을 `artifacts\beta-test-3day\sessions\YYYY-MM-DD.md`에 세션별로 추가한다.

```markdown
## H+<elapsed-hour> / <HH:MM–HH:MM KST> / <surface>

- `evidence_id`: D<day>-<HHMM>-<SURFACE>-<sequence>
- `timestamp_kst`:
- `elapsed_hour`:
- `market_state`:
- `persona_sleeve`: 단타 | 국장 중기 | 미장 장기 | 전술적 축소
- `session_goal`:
- `exact_utterance`:
- `follow_up_utterance`:
- `start_surface`:
- `end_surface`:
- `computer_actions`:
- `expected_behavior`:
- `actual_behavior`:
- `data_provenance`: live | mock | cache | fixture | UI draft | unknown
- `data_as_of`:
- `latency_ms`:
- `continuity`:
- `safety_boundary`:
- `broker_mutation_count`: 0
- `alert_lifecycle`: draft only | not tested
- `plugin_state`: preview only | UI draft | runtime unavailable | not tested
- `trust_score_1_5`:
- `friction_score_1_5`:
- `severity`: Critical | Major | Minor | Observation / pass
- `repro_steps`:
- `evidence_refs`:
- `workaround`:
- `status`: new | reproduced | recovered | pass
- `recommended_owner`:
- `improvement_proposal`:
```

## 누락 시간 슬롯

실제 세션을 수행하지 못한 시간은 성공 세션으로 소급 작성하지 않는다.

```markdown
## H+<elapsed-hour> / missed checkpoint

- `timestamp_kst`:
- `status`: missed
- `reason`:
- `runtime_evidence`:
- `broker_mutation_count`: 0
```

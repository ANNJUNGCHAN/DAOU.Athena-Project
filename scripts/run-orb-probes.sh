#!/usr/bin/env bash
# 오브 프로브 전수 실행 — 하나씩 순서대로 돌린다(각자 Electron 창을 띄우므로 병렬은 서로 방해한다).
command -v node >/dev/null 2>&1 || export PATH="$HOME/AppData/Roaming/fnm/node-versions/v22.14.0/installation:$PATH"
# 기본은 이 저장소의 app/. 기준선 대조(KIUMI_AUDIT_STATUS.md §2.3)처럼 다른 체크아웃에서
# 돌릴 때는 ATHENA_APP_DIR로 넘긴다 — 스크립트를 편집하지 않는다.
APP="${ATHENA_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../app" && pwd)}"
LOGDIR="/tmp/orb-probes"
mkdir -p "$LOGDIR"
cd "$APP" || exit 1

SUMMARY="$LOGDIR/SUMMARY.txt"
: > "$SUMMARY"

for f in probe-orb-*.js; do
  name="${f%.js}"
  # 이전 실행이 남긴 프로파일을 지운다(잠겨 있으면 Electron을 먼저 정리).
  taskkill //F //IM electron.exe //T >/dev/null 2>&1
  sleep 2
  rm -rf ".${name}-profile" 2>/dev/null

  start=$(date +%s)
  ./node_modules/.bin/electron "$f" > "$LOGDIR/$name.log" 2>&1
  code=$?
  dur=$(( $(date +%s) - start ))

  ok=$(grep -c "OK —" "$LOGDIR/$name.log" 2>/dev/null || echo 0)
  fail=$(grep -c "FAIL —" "$LOGDIR/$name.log" 2>/dev/null || echo 0)
  printf "%-34s exit=%-3s ok=%-4s fail=%-4s %ss\n" "$name" "$code" "$ok" "$fail" "$dur" >> "$SUMMARY"
  echo "[done] $name exit=$code ok=$ok fail=$fail ${dur}s"
done

taskkill //F //IM electron.exe //T >/dev/null 2>&1
echo "=== SUMMARY ==="
cat "$SUMMARY"

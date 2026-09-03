"""카드 표면 디자인 현황 — 로컬 실시간 대시보드.

실행: python scripts/surface_dashboard.py [--port 8765]
원장을 요청마다 다시 읽으므로(캐시는 mtime 기준) PAPER_CARD_COVERAGE.json ·
PAPER_FIELD_COVERAGE.json · .omc/progress.txt 가 바뀌면 화면이 5초 안에 따라온다.
표면 템플릿 저작 진행(backend/ref/card-surface-templates)은 card_surface_coverage.collect()에서 받는다.
그 값의 바인딩 판정은 백엔드 로더(athena_api.card_surface_templates)가 한 것이고, 단위는 occurrence다.
표준: docs/ui/paper-card-surface-charter.md (표현 3층 · 밀도 예산 · 표면 문법 7종).
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OP_LEDGER = ROOT / "PAPER_CARD_COVERAGE.json"
FIELD_LEDGER = ROOT / "PAPER_FIELD_COVERAGE.json"
PROGRESS = ROOT / ".omc" / "progress.txt"

CARD_TITLES = {
    "CC-01": "계좌", "CC-02": "주문", "CC-03": "종목·상품",
    "CC-04": "호가", "CC-05": "수급", "CC-06": "탐색",
}
MILESTONES = [60, 70, 80, 90, 100]
GRAMMAR = [
    ("A", "스택 셀", r"전일대비|대비기호|등락율|등락률|수량\(천\)|순매수수량|매도수량|매수수량|거래량$|누적거래량"),
    ("B", "표준 열 세트", r"^시가|^고가|^저가|매도호가|매수호가|매도잔량|매수잔량|매도금액|매수금액|매도총|매수총|거래대금|회전율|체결강도"),
    ("C", "세부 행 확장", r"국가|기타법인|내외국인|보험|투신|은행|연기금|사모|금융투자|거래원|외국계|기관|개인|투자자|증권사|회원사"),
    ("D", "코드·구분 병기", r"코드|구분|번호|ticker|ISIN|일련|SOR|통신|처리|Extra|스톱"),
    ("E", "시각·상태 표기", r"시간|장전|장중|장후|일자|날짜|시각"),
    ("F", "펼침 상태 보드", r"증거금|보증금|재사용|신용|대출|담보|대주|미수|연체|이자|대여|세$|세금|수수료|정산|변제|상환|중간가|직전대비|잔량대비|차선|LP|D\+|d\+|기초|기말|_fr|_to"),
]
GRAMMAR_RE = [(sym, name, re.compile(pat)) for sym, name, pat in GRAMMAR]

try:  # 표면 템플릿 저작 현황 (scripts/card_surface_coverage.py)
    from card_surface_coverage import INDEX as TPL_INDEX
    from card_surface_coverage import TPL_DIR
    from card_surface_coverage import collect as surface_collect
except ImportError:  # 스크립트 없이도 기존 화면은 그대로 동작
    surface_collect = None

_cache: dict[str, tuple[float, object]] = {}
_surface_cache: tuple[tuple, dict] | None = None


def _load(path: Path):
    """mtime 캐시. 파일이 없으면 None."""
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    hit = _cache.get(str(path))
    if hit and hit[0] == mtime:
        return hit[1]
    if path.suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        data = path.read_text(encoding="utf-8", errors="replace")
    _cache[str(path)] = (mtime, data)
    return data


def grammar_of(kor: str, f: str) -> str:
    for sym, _, rx in GRAMMAR_RE:
        if rx.search(kor) or rx.search(f):
            return sym
    return "G"


def surface_state() -> dict | None:
    """표면 템플릿 저작 현황. 디렉터리 mtime 서명이 그대로면 재계산하지 않는다.

    바인딩 판정은 `card_surface_coverage.collect()`가 백엔드 로더에 위임한 결과를
    그대로 쓴다 — 대시보드가 자기 숫자를 따로 세면 현황판과 두 값이 나온다.
    """
    global _surface_cache
    if surface_collect is None:
        return None
    sig = (
        TPL_DIR.stat().st_mtime if TPL_DIR.exists() else 0,
        TPL_INDEX.stat().st_mtime if TPL_INDEX.exists() else 0,
        tuple(sorted((p.name, p.stat().st_mtime) for p in TPL_DIR.iterdir() if p.is_dir()))
        if TPL_DIR.exists() else (),
    )
    if _surface_cache and _surface_cache[0] == sig:
        return _surface_cache[1]
    try:
        s = surface_collect()
    except Exception as exc:  # noqa: BLE001 — 로더가 죽어도 나머지 화면은 살려 둔다
        trimmed = {"error": f"{type(exc).__name__}: {exc}"}
        _surface_cache = (sig, trimmed)
        return trimmed
    b, o, ld = s["boards"], s["occ"], s["loader"]
    trimmed = {
        # 보드 모수는 로더가 실제로 세운 보드다(card_surface_coverage와 같은 수).
        "boards": {k: b[k] for k in ("total", "indexed", "on_disk", "saved", "extracted", "clean")},
        "occ": {"visible": o["visible"], "bound": o["bound"], "gap": o["gap"], "pct": o["pct"]},
        "by_card": [{"card": c["card"], "pct": c["pct"], "bound": c["bound"], "n": c["n"]} for c in o["by_card"]],
        "by_layer": o["by_layer"],
        "ops": {"total": s["ops"]["total"], "with_board": s["ops"]["with_board"],
                "without_board": [x["op"] for x in s["ops"]["without_board"]]},
        "density": len(s["density"]), "density_soft": len(s["density_soft"]),
        "dups": len(s["dups"]), "other_problems": len(s["other_problems"]),
        "restatements": s["restatements"], "errors": len(s["errors"]),
        # 재귀속은 "미도달 occurrence 중 원장 귀속이 트리 밖 보드인 것"만 센다.
        "reattach": s["reattach"]["total"],
        "reattach_boards": list(s["reattach"]["by_board"]),
        "excluded": [{"board": e["board"], "reason": e["reason"]} for e in s["excluded"]],
        "loader": {"path": ld["path"], "coverage_source": ld["coverage_source"],
                   "complete": ld["complete"]},
    }
    _surface_cache = (sig, trimmed)
    return trimmed


def build_state() -> dict:
    ops = _load(OP_LEDGER) or {"statuses": {}, "updated": ""}
    fields = _load(FIELD_LEDGER) or {"rows": [], "universe": 0, "hidden": 0, "updated": ""}
    progress = _load(PROGRESS) or ""

    # --- op 단위
    op_total = Counter(e["status"] for e in ops["statuses"].values())
    op_by_card: dict[str, Counter] = defaultdict(Counter)
    for e in ops["statuses"].values():
        op_by_card[e["card"]][e["status"]] += 1
    op_n = sum(op_total.values())

    # --- 필드 단위
    all_rows = fields["rows"]
    rows = [r for r in all_rows if r["cls"] != "비노출"]
    hidden_extra = len(all_rows) - len(rows)
    f_total = Counter(r["cls"] for r in rows)
    f_by_card: dict[str, Counter] = defaultdict(Counter)
    gap_by_grammar: dict[str, Counter] = defaultdict(Counter)
    miss_by_op: Counter = Counter()
    op_name_hint: dict[str, str] = {}
    for r in rows:
        f_by_card[r["card"]][r["cls"]] += 1
        if r["cls"] != "표현":
            gap_by_grammar[grammar_of(r["kor"], r["f"])][r["card"]] += 1
        if r["cls"] == "미표현":
            miss_by_op[r["mapping_id"]] += 1
    visible = len(rows)
    expressed = f_total["표현"]
    pct = expressed / visible * 100 if visible else 0.0
    next_ms = next((m for m in MILESTONES if m > pct + 1e-9), None)

    cards = []
    for card in sorted(CARD_TITLES):
        o = op_by_card[card]
        f = f_by_card[card]
        fn = sum(f.values())
        cards.append({
            "card": card, "title": CARD_TITLES[card],
            "op": {"n": sum(o.values()), "표현": o["표현"], "부분": o["부분"], "없음": o["없음"], "계정": o["계정"]},
            "field": {"n": fn, "표현": f["표현"], "집약": f["집약"], "미표현": f["미표현"],
                      "pct": (f["표현"] / fn * 100) if fn else 0.0},
        })

    grammar = []
    for sym, name, _ in GRAMMAR + [("G", "신설 표면", "")]:
        by = gap_by_grammar.get(sym, Counter())
        grammar.append({"sym": sym, "name": name, "total": sum(by.values()),
                        "by_card": {c: by[c] for c in sorted(CARD_TITLES) if by[c]}})

    total_by_op: Counter = Counter(r["mapping_id"] for r in rows)
    worst = [{"mapping_id": m, "miss": k, "n": total_by_op[m]} for m, k in miss_by_op.most_common(10)]

    tail = [ln for ln in progress.splitlines() if ln.strip()][-8:]

    return {
        "now": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sources": {
            "op_ledger": {"path": OP_LEDGER.name, "updated": ops.get("updated", ""), "mtime": _fmt_mtime(OP_LEDGER)},
            "field_ledger": {"path": FIELD_LEDGER.name, "updated": fields.get("updated", ""), "mtime": _fmt_mtime(FIELD_LEDGER)},
            "progress": {"path": ".omc/progress.txt", "mtime": _fmt_mtime(PROGRESS)},
        },
        "op": {"n": op_n, "표현": op_total["표현"], "부분": op_total["부분"], "없음": op_total["없음"], "계정": op_total["계정"],
               "goal_pct": ((op_total["표현"] + op_total["계정"]) / op_n * 100) if op_n else 0.0},
        "field": {"universe": fields.get("universe", 0), "hidden": fields.get("hidden", 0) + hidden_extra, "visible": visible,
                  "표현": expressed, "집약": f_total["집약"], "미표현": f_total["미표현"],
                  "pct": pct, "gap": visible - expressed, "next_milestone": next_ms, "milestones": MILESTONES},
        "cards": cards,
        "grammar": grammar,
        "worst_ops": worst,
        "progress_tail": tail,
        "surface": surface_state(),
    }


def _fmt_mtime(p: Path) -> str:
    return time.strftime("%m-%d %H:%M:%S", time.localtime(p.stat().st_mtime)) if p.exists() else "—"


PAGE = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>카드 표면 현황</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Geist+Mono:wght@400;500;600&display=swap">
<style>
  :root { --ground:#eef0f4; --panel:#fff; --panel2:#f7f8fa; --ink:#14171d; --dim:#5b6270; --faint:#8b93a1;
    --line:rgba(16,19,26,.12); --line-soft:rgba(16,19,26,.07); --up:#d92b2b; --down:#1f6fd4; --brand:#ee137b; --agg:#c9a227; --ok:#2f9e5a;
    --sans:'Noto Sans KR',-apple-system,'Segoe UI','Malgun Gothic',sans-serif; --mono:'Geist Mono',ui-monospace,Consolas,monospace; }
  @media (prefers-color-scheme: dark) { :root { --ground:#0f1216; --panel:#171b22; --panel2:#1d222a; --ink:#e7eaf0; --dim:#a2a9b5; --faint:#6e7583;
    --line:rgba(255,255,255,.12); --line-soft:rgba(255,255,255,.07); --up:#ff6b6b; --down:#63a4ff; --brand:#ff4f9d; --agg:#d9b64a; --ok:#4fc47a; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:var(--sans); font-size:13.5px; line-height:1.55; }
  .page { max-width:1180px; margin:0 auto; padding:28px 22px 60px; display:flex; flex-direction:column; gap:18px; }
  header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  h1 { margin:0; font-size:22px; font-weight:700; letter-spacing:-.01em; }
  .eyebrow { font-family:var(--mono); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); }
  .live { display:flex; align-items:center; gap:8px; font-family:var(--mono); font-size:11.5px; color:var(--dim); }
  .live i { width:8px; height:8px; border-radius:50%; background:var(--ok); display:inline-block; box-shadow:0 0 0 0 rgba(47,158,90,.5); animation:pulse 2s infinite; }
  .live.stale i { background:var(--faint); animation:none; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(47,158,90,.45)} 70%{box-shadow:0 0 0 7px rgba(47,158,90,0)} 100%{box-shadow:0 0 0 0 rgba(47,158,90,0)} }
  @media (prefers-reduced-motion: reduce) { .live i { animation:none } }
  .mono { font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .kpis { display:grid; grid-template-columns:repeat(5,1fr); border:1px solid var(--line-soft); border-radius:12px; background:var(--panel); overflow:hidden; }
  .kpi { padding:14px 16px; border-right:1px solid var(--line-soft); display:flex; flex-direction:column; gap:2px; }
  .kpi:last-child { border-right:0 }
  .kpi .l { font-size:11px; color:var(--faint) } .kpi .v { font-family:var(--mono); font-size:24px; font-weight:600; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
  .kpi .s { font-size:11px; color:var(--dim) } .kpi.goal .v { color:var(--brand) }
  .kpi .v.flash { animation:flash 1.2s ease-out } @keyframes flash { 0%{background:rgba(238,19,123,.18)} 100%{background:transparent} }
  .card { background:var(--panel); border:1px solid var(--line-soft); border-radius:12px; padding:16px 18px; display:flex; flex-direction:column; gap:10px; }
  h2 { margin:0; font-size:14.5px; font-weight:700 }
  .track { position:relative; height:26px; border-radius:8px; overflow:hidden; display:flex; font-family:var(--mono); font-size:11px; color:#fff; }
  .track > div { display:flex; align-items:center; justify-content:center; white-space:nowrap; transition:width .6s ease; }
  .b1 { background:var(--ink) } .b2 { background:var(--agg); color:#1a1400 } .b3 { background:var(--line); color:var(--dim) }
  .ticks { position:relative; height:16px; font-family:var(--mono); font-size:10.5px; color:var(--faint); }
  .ticks span { position:absolute; transform:translateX(-50%); }
  .ticks span::before { content:""; position:absolute; left:50%; top:-8px; width:1px; height:6px; background:var(--line); }
  .ticks span.goal { color:var(--brand) }
  .grid { display:grid; grid-template-columns:1.4fr 1fr; gap:14px; }
  table { border-collapse:collapse; width:100%; font-size:12.5px; }
  th,td { padding:7px 10px; text-align:left; border-bottom:1px solid var(--line-soft); vertical-align:middle; white-space:nowrap; }
  th { font-size:11px; font-weight:500; color:var(--faint); background:var(--panel2) }
  tr:last-child td { border-bottom:0 } td.n,th.n { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
  td.k { font-weight:700 } .tw { overflow-x:auto }
  .mini { display:inline-block; width:90px; height:7px; border-radius:4px; background:var(--line-soft); vertical-align:middle; margin-right:8px; overflow:hidden; }
  .mini i { display:block; height:100%; background:var(--ink); transition:width .6s ease; }
  .sym { font-family:var(--mono); font-weight:600; font-size:11.5px; width:20px; height:20px; border-radius:5px; background:var(--ink); color:var(--panel); display:inline-flex; align-items:center; justify-content:center; margin-right:8px; }
  .chips { display:flex; flex-wrap:wrap; gap:4px 8px; font-family:var(--mono); font-size:10.5px; color:var(--dim); }
  .stages { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
  .stage { background:var(--panel2); border:1px solid var(--line-soft); border-radius:9px; padding:9px 11px; display:flex; flex-direction:column; gap:5px; }
  .stage .l { font-size:11px; color:var(--faint) }
  .stage .v { font-family:var(--mono); font-size:17px; font-weight:600; font-variant-numeric:tabular-nums; }
  .stage .v em { font-style:normal; font-size:12px; color:var(--faint) }
  .stage .mini { width:100%; margin:0 }
  .log { font-family:var(--mono); font-size:11.5px; color:var(--dim); display:flex; flex-direction:column; gap:5px; }
  .log div { white-space:pre-wrap; word-break:break-all; border-left:2px solid var(--line); padding-left:10px; }
  .log div:last-child { border-left-color:var(--ink); color:var(--ink); }
  .src { font-family:var(--mono); font-size:11px; color:var(--faint); display:flex; flex-wrap:wrap; gap:4px 16px; }
  @media (max-width:820px) { .kpis { grid-template-columns:repeat(2,1fr) } .kpi { border-bottom:1px solid var(--line-soft) } .grid { grid-template-columns:1fr } }
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <div class="eyebrow">Athena · Paper 카드 페이지 · 디자인 표현 현황</div>
      <h1>카드 표면 현황</h1>
    </div>
    <div class="live" id="live"><i></i><span id="livetxt">연결 중</span></div>
  </header>

  <div class="kpis">
    <div class="kpi"><span class="l">op 표현</span><span class="v" id="k-op">—</span><span class="s" id="k-op-s">299 operations</span></div>
    <div class="kpi"><span class="l">필드 표현 (직접)</span><span class="v" id="k-pct">—</span><span class="s" id="k-pct-s"></span></div>
    <div class="kpi"><span class="l">집약 — 목표 0</span><span class="v" id="k-agg">—</span><span class="s">합계·대표값에 흡수</span></div>
    <div class="kpi"><span class="l">미표현</span><span class="v" id="k-miss">—</span><span class="s">어느 보드에도 없음</span></div>
    <div class="kpi goal"><span class="l">다음 마일스톤</span><span class="v" id="k-next">—</span><span class="s" id="k-next-s"></span></div>
  </div>

  <div class="card">
    <h2>필드 표현율 — 가시 필드 기준</h2>
    <div class="track"><div class="b1" id="t1"></div><div class="b2" id="t2"></div><div class="b3" id="t3"></div></div>
    <div class="ticks" id="ticks"></div>
    <div class="src" id="universe"></div>
  </div>

  <div class="card" id="surface-card">
    <h2>표면 템플릿 — 보드 저작 · occurrence 도달</h2>
    <div class="stages" id="stages"></div>
    <div class="track"><div class="b1" id="s1"></div><div class="b3" id="s3"></div></div>
    <div class="chips" id="surface-cards"></div>
    <div class="src" id="surface-src"></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>카드별</h2>
      <div class="tw"><table>
        <thead><tr><th>카드</th><th class="n">op 표현</th><th class="n">가시 필드</th><th>표현율</th><th class="n">표현</th><th class="n">집약</th><th class="n">미표현</th></tr></thead>
        <tbody id="cards"></tbody>
      </table></div>
    </div>
    <div class="card">
      <h2>남은 갭 — 표면 문법별</h2>
      <div class="tw"><table>
        <thead><tr><th>문법</th><th class="n">필드</th><th>카드 분포</th></tr></thead>
        <tbody id="grammar"></tbody>
      </table></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>결손이 큰 operation</h2>
      <div class="tw"><table>
        <thead><tr><th>mapping</th><th class="n">미표현</th><th class="n">가시</th><th>비율</th></tr></thead>
        <tbody id="worst"></tbody>
      </table></div>
    </div>
    <div class="card">
      <h2>최근 진행 기록</h2>
      <div class="log" id="log"></div>
    </div>
  </div>

  <div class="src" id="sources"></div>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString('ko-KR');
  let prev = null, lastOk = 0;
  function setv(id, text) { const el = $(id); if (el.textContent !== text) { el.textContent = text; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
  function render(s) {
    const f = s.field, o = s.op;
    setv('k-op', `${o['표현']}/${o.n}`); $('k-op-s').textContent = `계정 ${o['계정']} · 목표 환산 ${o.goal_pct.toFixed(1)}%`;
    setv('k-pct', f.pct.toFixed(1) + '%'); $('k-pct-s').textContent = `${fmt(f['표현'])} / ${fmt(f.visible)}`;
    setv('k-agg', fmt(f['집약'])); setv('k-miss', fmt(f['미표현']));
    setv('k-next', f.next_milestone ? f.next_milestone + '%' : '도달'); $('k-next-s').textContent = f.next_milestone ? `+${fmt(Math.ceil(f.visible * f.next_milestone / 100) - f['표현'])} 필드 남음` : '표현 100%';
    const p1 = f.pct, p2 = f['집약'] / f.visible * 100, p3 = 100 - p1 - p2;
    $('t1').style.width = p1 + '%'; $('t1').textContent = `표현 ${p1.toFixed(1)}%`;
    $('t2').style.width = p2 + '%'; $('t2').textContent = p2 > 6 ? `집약 ${p2.toFixed(1)}%` : '';
    $('t3').style.width = p3 + '%'; $('t3').textContent = p3 > 8 ? `미표현 ${p3.toFixed(1)}%` : '';
    $('ticks').innerHTML = f.milestones.map(m => `<span class="${m === 100 ? 'goal' : ''}" style="left:${m}%">${m}</span>`).join('');
    $('universe').innerHTML = `<span>모수 ${fmt(f.universe)}</span><span>비노출 ${fmt(f.hidden)} (전송·내부·명문 계정)</span><span>가시 ${fmt(f.visible)}</span><span>갭 ${fmt(f.gap)}</span>`;
    $('cards').innerHTML = s.cards.map(c => `<tr><td class="k">${c.card} ${c.title}</td><td class="n">${c.op['표현']}/${c.op.n}</td><td class="n">${fmt(c.field.n)}</td><td><span class="mini"><i style="width:${c.field.pct}%"></i></span><span class="mono">${c.field.pct.toFixed(0)}%</span></td><td class="n">${fmt(c.field['표현'])}</td><td class="n">${fmt(c.field['집약'])}</td><td class="n">${fmt(c.field['미표현'])}</td></tr>`).join('');
    $('grammar').innerHTML = s.grammar.map(g => `<tr><td><span class="sym">${g.sym}</span>${g.name}</td><td class="n">${fmt(g.total)}</td><td><div class="chips">${Object.entries(g.by_card).map(([c, n]) => `<span>${c.replace('CC-0', '')} ${n}</span>`).join('')}</div></td></tr>`).join('');
    $('worst').innerHTML = s.worst_ops.map(w => `<tr><td class="mono">${w.mapping_id}</td><td class="n">${w.miss}</td><td class="n">${w.n}</td><td><span class="mini"><i style="width:${w.miss / w.n * 100}%;background:var(--faint)"></i></span><span class="mono">${(w.miss / w.n * 100).toFixed(0)}%</span></td></tr>`).join('');
    const su = s.surface;
    $('surface-card').hidden = !su;
    if (su && su.error) {
      $('stages').innerHTML = ''; $('surface-cards').innerHTML = '';
      $('s1').style.width = '0%'; $('s3').style.width = '100%'; $('s3').textContent = '로더 없음';
      $('surface-src').innerHTML = `<span style="color:var(--up)">표면 로더 오류 — ${su.error}</span>`;
    } else if (su) {
      const sb = su.boards, so = su.occ;
      $('stages').innerHTML = [['원문 저장', 'saved'], ['추출', 'extracted'], ['로드', 'total'], ['문제 없음', 'clean']]
        .map(([label, k]) => `<div class="stage"><span class="l">${label}</span><span class="v">${sb[k]}<em>/${sb.total}</em></span><span class="mini"><i style="width:${sb[k] / sb.total * 100}%"></i></span></div>`).join('');
      const bp = so.pct;
      $('s1').style.width = bp + '%'; $('s1').textContent = bp > 12 ? `도달 ${bp.toFixed(1)}%` : '';
      $('s3').style.width = (100 - bp) + '%'; $('s3').textContent = `미도달 ${fmt(so.gap)}`;
      $('surface-cards').innerHTML = su.by_card.map(c => `<span>${c.card.replace('CC-0', 'C')} ${fmt(c.bound)}/${fmt(c.n)} ${c.pct.toFixed(0)}%</span>`).join('')
        + su.by_layer.map(l => `<span>${l.layer} ${fmt(l.bound)}/${fmt(l.n)} (슬롯 판정 ${fmt(l.declared)})</span>`).join('');
      $('surface-src').innerHTML = `<span>occurrence 도달 ${fmt(so.bound)} / 가시 ${fmt(so.visible)}</span>`
        + `<span>보드 ${sb.total}장 로드 (색인 ${sb.indexed} · 디렉터리 ${sb.on_disk})</span>`
        + `<span>op 커버 ${su.ops.with_board}/${su.ops.total}</span>`
        + `<span>밀도 하드 ${su.density} · 소프트 ${su.density_soft}</span>`
        + `<span>중복 바인딩 ${su.dups} · 그 밖의 보드 문제 ${su.other_problems} · 재표시 ${su.restatements}</span>`
        + `<span>판정 위임 ${su.loader.path} · ${su.loader.coverage_source}</span>`
        + (su.excluded.length ? `<span>제외 ${su.excluded.map(e => e.board).join(' · ')}</span>` : '')
        + (su.ops.without_board.length ? `<span style="color:var(--agg)">보드 없는 op ${su.ops.without_board.join(' · ')}</span>` : '')
        + (su.reattach ? `<span style="color:var(--agg)">재귀속 필요 ${fmt(su.reattach)} — 미도달 중 원장 귀속이 ${su.reattach_boards.join(' · ')}</span>` : '')
        + (su.errors ? `<span style="color:var(--up)">해석 안 되는 바인딩 ${su.errors}</span>` : '');
    }
    $('log').innerHTML = s.progress_tail.map(l => `<div>${l.replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]))}</div>`).join('');
    const src = s.sources; $('sources').innerHTML = `<span>${src.op_ledger.path} · 갱신 ${src.op_ledger.mtime}</span><span>${src.field_ledger.path} · 갱신 ${src.field_ledger.mtime}</span><span>${src.progress.path} · 갱신 ${src.progress.mtime}</span><span>서버 ${s.now}</span>`;
  }
  async function tick() {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' }); const s = await r.json();
      render(s); lastOk = Date.now(); $('live').classList.remove('stale'); $('livetxt').textContent = `실시간 · 5초마다 · ${s.now.slice(11)}`;
    } catch (e) { $('live').classList.add('stale'); $('livetxt').textContent = '서버 응답 없음 — 재시도 중'; }
  }
  tick(); setInterval(tick, 5000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path.startswith("/api/state"):
            body = json.dumps(build_state(), ensure_ascii=False).encode("utf-8")
            self._send(200, "application/json; charset=utf-8", body)
        elif self.path in ("/", "/index.html"):
            self._send(200, "text/html; charset=utf-8", PAGE.encode("utf-8"))
        elif self.path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
        else:
            self._send(404, "text/plain; charset=utf-8", b"not found")

    def do_HEAD(self):  # noqa: N802 — 프리뷰 도구의 생존 확인용
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()

    def _send(self, code: int, ctype: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # 조용히
        if "/api/state" not in str(args[0] if args else ""):
            super().log_message(fmt, *args)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"카드 표면 현황 → http://127.0.0.1:{args.port}  (원장: {OP_LEDGER.name}, {FIELD_LEDGER.name})")
    srv.serve_forever()


if __name__ == "__main__":
    main()

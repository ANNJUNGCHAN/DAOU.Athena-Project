# -*- coding: utf-8 -*-
"""Athena Paper 정합 판정 v4 — 2026-09-07 구현 4차 결과 보고서 생성기(최종)."""
import json, html, io, sys, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SP = r'C:/Projects/DAOU.Athena/docs/handoff/2026-09-07-paper-parity'
ROOT = 'C:/Projects/DAOU.Athena'

head = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--short', 'origin/main'], capture_output=True, text=True).stdout.strip()
n_commits = subprocess.run(['git', '-C', ROOT, 'rev-list', '--count', '--no-merges', 'c33ef0a..origin/main'], capture_output=True, text=True).stdout.strip()
types = subprocess.run(['git', '-C', ROOT, 'log', '--no-merges', '--format=%s', 'c33ef0a..origin/main'], capture_output=True, text=True, encoding='utf-8').stdout.splitlines()
from collections import Counter
tc = Counter()
for s in types:
    t = s.split('(')[0].split(':')[0].strip()
    tc[t] += 1

screens = json.load(open(f'{SP}/gaps-screens-annotated-v4.json', encoding='utf-8'))
cards = json.load(open(f'{SP}/gaps-cards-v4.json', encoding='utf-8'))['gaps']
manifest = json.load(open(f'{ROOT}/backend/ref/paper-ledger/manifest.json', encoding='utf-8'))
names = {b['id']: (b['page'], b.get('name', ''), b['role']) for b in manifest['boards']}
ratchet = json.load(open(f'{ROOT}/app/lib/paper-screens-ratchet.json', encoding='utf-8'))
scr = json.load(open(f'{ROOT}/app/captures/paper-gates/PAPER-SCREENS.json', encoding='utf-8'))['totals']
cardsrep = json.load(open(f'{ROOT}/app/captures/paper-gates/PAPER-CARDS.json', encoding='utf-8'))['totals']
mini = json.load(open(f'{ROOT}/app/captures/paper-gates/PAPER-MINI.json', encoding='utf-8'))['totals']

# 결정 갈래 배정 — 남은 7장 (화면 4 + 계약 2 + 카드 1)
GROUPS = {
  'A': ('Paper 캡션 한 줄이 빠져 계약을 잴 수 없다', '같은 갈래의 형제 보드는 마침표 캡션을 달아 계약 문장이 잡히는데 이 두 장만 없다. Paper 에 캡션을 적으면 닫히고, 코드는 이미 문서·구현이 있다.',
        ['1XA2-0', '2DZE-0']),
  'B': ('Paper 안에서 보드끼리 반대말을 한다 — 실측 확인', '보드 10 의 「무엇으로 시작할까요 — 프리셋 10종」을 보드 19 가 「프리셋이라는 구분은 없습니다. 목록은 하나뿐이고…」로 이름을 대어 부정한다. 어느 보드를 정본으로 둘지 Paper 쪽 결정이 필요하다. 오류 상태 절반(실패·비활성 배지, 내부 변수 이름 노출 제거)은 4차에서 구현했다.',
        ['2GZM-2']),
  'C': ('잠긴 계약·이전 사용자 결정과 충돌한다', 'Paper 원문과 이미 확정된 제품 결정(키우미 얼굴 1종 · 빈 캔버스 문구 회전)이 반대말을 한다. 어느 쪽을 정본으로 둘지 사용자 결정이 필요하다.',
        ['2I7Z-2', '3KM-0']),
  'D': ('앱 구조와 잠긴 창 모델을 바꿔야 한다 — 크기 L', '상주 채팅 세션이 프로세스 전역에 하나뿐인 구조 위에는 없는 화면이고, 「같은 순간, 두 창」은 pre-push 게이트가 잠근 창 모델(셸 1 + 오브 1)과도 어긋난다. 동시 실행 구조를 세울지 결정이 필요하다.',
        ['3W9B-1']),
  'E': ('카드 1장 — Paper 의 문 구조', '카드 96장 중 95장이 정적·런타임 4폭 게이트를 통과한다. 남은 1장은 Paper 가 「순위」 칩 하나에 보드 두 장을 매달아 신주인수권 보드로 가는 문이 없다.',
        ['137X-2']),
}
by_id = {g['board']: g for g in screens}
for c in cards:
    by_id[c['board']] = c
assigned = {b for _, (_, _, ids) in GROUPS.items() for b in ids}
still = [g for g in screens if g['still_failing']]
missing = [g['board'] for g in still if g['board'] not in assigned]
assert not missing, missing

def esc(s):
    return html.escape(str(s or ''))

def board_row(bid):
    g = by_id.get(bid)
    pg, nm, role = names.get(bid, ('5-1', '', 'card_template'))
    r3 = (g or {}).get('round4') or (g or {}).get('round3')
    size = ((r3 or {}).get('gap_size') or (g or {}).get('gap_size')) or '–'
    detail = (r3 or {}).get('detail') or (g or {}).get('detail', '')
    files = (r3 or {}).get('gap_files') or (g or {}).get('gap_files', [])
    files_html = ''
    if files:
        files_html = '<div class="files">' + ' · '.join(esc(f.replace('C:/Projects/DAOU.Athena-parity/', '').replace('C:/Projects/DAOU.Athena-gates/', '')) for f in files) + '</div>'
    return f'''<details class="board"><summary><span class="bid mono">{esc(bid)}</span><span class="bpage mono">{esc(pg)}</span><span class="bname">{esc(nm)}</span><span class="bsize mono">{esc(size)}</span></summary>
<div class="bbody"><div class="detail">{esc(detail)}</div>{files_html}</div></details>'''

groups_html = ''
for key, (title, lead, ids) in GROUPS.items():
    rows = ''.join(board_row(b) for b in ids)
    groups_html += f'''<section class="group"><h3><span class="gkey mono">{key}</span> {esc(title)} <span class="gcount mono">{len(ids)}장</span></h3><p class="glead">{esc(lead)}</p>{rows}</section>'''

# 구현 3차에서 닫힌 보드 (round3 pass)
def _closed_round(g):
    for k in ('round4', 'round3'):
        r = g.get(k)
        if r and r.get('status') == 'pass':
            return r
    return None
closed3 = [g for g in screens + cards if _closed_round(g)]
def closed_row(g):
    bid = g['board']; r3 = _closed_round(g)
    pg, nm, role = names.get(bid, ('5-1', '', 'card_template'))
    return f'''<details class="board"><summary><span class="bid mono">{esc(bid)}</span><span class="bpage mono">{esc(pg)}</span><span class="bname">{esc(nm)}</span><span class="bsize mono">{esc(r3['track'][-1])}</span></summary>
<div class="bbody"><div class="detail">{esc(r3['detail'])}</div></div></details>'''
closed3_html = ''.join(closed_row(g) for g in closed3)
# 통과했지만 Paper 가 더 그린 것이 있는 보드 (라우트 pass + gap 기록, 3차 이전)
partial = [g for g in screens if not g['still_failing'] and not g.get('round3') and not g.get('round4')]
partial_html = ''.join(board_row(g['board']) for g in partial)

# 트랙별 성과 요약 표
tracks = [
  ('수정 트랙 (parity 워크트리)', '22작업 전부 main 반영', '카드 라우팅 축 전환 · 보드 하이드레이션 · 상태 링크 · 시세→2R3M-1 착지 · 137X-2 차트 마운트 · 13BC-2·1JPU-0 호가 사다리 마운트 · 화면 1~5군(문구·색·설정 오버레이·계좌 전환·성향·이력 카드·계좌 등록 3상태·오브 표시 모드·백테스트 중단/비교/배포·에이전트 결과 턴·자동 검사) · 문서 정합'),
  ('화면 트랙 (gates 워크트리 + 재저작)', '래칫 8 → 92장 / 115장', '부팅 5 · 온보딩 3 · 셸 2 · 대화·계정 2 · 인증 3 · 사이드바 3+1 · 모드·펜 3 · 반응형·복원·탭 3 · 그래프 5+2 · 에이전트 4+2 · 플러그인 9 · 키우미 4 · 계좌·주문 5 · 백테스트 18 · 설정 성향·이력 1 · 계약 문서화 10/12 · 검색 빈 결과판 구현 · Grok 공급자 UI 뒷정리 · 오브 눈 프로브 흔들림 제거'),
  ('카드 트랙 (parity 워크트리)', '카드 게이트 64 → 93 / 96장', '원장 SVG 축 글자 보강(137X-2·2RJ7-1·32S7-0) · 좁은 카드 absolute 상자·양끝 줄·병기 줄 접기 · 순위·가격 슬롯 계약을 Paper 문면으로 · 병기 사본 갱신 · KPI 탄력 칸 바닥 · 세로 쌓임 높이 · 2XP6-0·3LGC-0 트리 정합'),
]
tracks += [
  ('구현 3차 트랙 A (parity 워크트리)', '6묶음 전부 main 반영', 'Paper 가 화면이 아니라고 선언한 보드 8장 role 재분류(명세 시트 5 → reference · 폐기 각주 1 → retired · 규칙표 2 → contract, 계약 문장 18개 문서화) · 카드 1WOB-1 정적 비교 범위를 카드 루트로(137X-2 는 Paper 문 구조상 gap 유지) · 프로젝트 추가 폴더 점유 대화상자 3상태 · 백테스트 작업공간 봉인·복원 + 부분 복원 안내 · 출처→규칙→지도→코드→자체검사 5단계 잡과 진행 화면 · 미니 카드 10종 검사 통로'),
  ('구현 3차 트랙 B (gates 워크트리)', '4묶음 전부 main 반영', '제어 제안 턴 A~E(근거 한 줄 + 사람 칩 게이트) · 작업 설정 드릴인 소스별 편집 폼 + 저장 왕복 · 코드 알람 고침 이력·다시 검사·한 바퀴 영수증·되돌리기 · 「이 노드 설명해줘」 entity 응답 패널 + 노드 조회 툴 칩'),
]
tracks += [
  ('구현 4차 트랙 C (parity 워크트리)', '3묶음 전부 main 반영', '카드 15R0-2 — 한글 폴백 폰트에 metric override 를 얹어 Paper 줄 높이 125% 를 지키게(보드 기하 불변, Daki 머신은 무변화) · 그래프 07 정직성 — 지도 범례(색 = 군집 · 원 크기 = 연결 수 · 채움 = 확정성 · 숨은 연관) + 라이브 지도 노드 채움에 확정성 티어 + 「군집 이름은 대표 항목에서 추정」 캡션(03·04 원장도 같은 범례라 충돌 아님을 실측) · 백테스트 10 — 오류 상태 배지(실패·비활성)와 내부 변수 이름 노출 제거, 503 원인 보존; 프리셋 고르기 절반은 보드 19 가 이름을 대어 부정해 gap 유지'),
]
tracks_html = ''.join(f'<tr><td>{esc(a)}</td><td class="mono">{esc(b)}</td><td>{esc(c)}</td></tr>' for a, b, c in tracks)

type_html = ' · '.join(f'{esc(k)} {v}' for k, v in tc.most_common())

page = f'''<title>Athena Paper 정합 판정</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root {{
  --bg:#EEF0F4; --panel:#FFFFFF; --panel2:#FAFBFC; --panel3:#F4F5F8; --line:rgb(16 19 26 / 14%); --line-soft:rgb(16 19 26 / 8%);
  --text:#14171D; --dim:#5B6270; --hint:rgb(16 19 26 / 45%);
  --brand:#EE137B; --up:#D92B2B; --ok:#3E9E2A; --warn:#D97A12; --info:#2F7FD6;
  --font-body:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif; --font-mono:'Geist Mono','Cascadia Mono',ui-monospace,monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg:#101318; --panel:#171B22; --panel2:#1C2129; --panel3:#222834; --line:rgb(255 255 255 / 14%); --line-soft:rgb(255 255 255 / 8%);
  --text:#EEF0F4; --dim:#A7AEBB; --hint:rgb(255 255 255 / 45%); --brand:#FF3E93; --up:#FF6B6B; --ok:#6FD65A; --warn:#FFB05A; --info:#6FB4FF;
}} }}
:root[data-theme="dark"] {{
  --bg:#101318; --panel:#171B22; --panel2:#1C2129; --panel3:#222834; --line:rgb(255 255 255 / 14%); --line-soft:rgb(255 255 255 / 8%);
  --text:#EEF0F4; --dim:#A7AEBB; --hint:rgb(255 255 255 / 45%); --brand:#FF3E93; --up:#FF6B6B; --ok:#6FD65A; --warn:#FFB05A; --info:#6FB4FF;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--text); font-family:var(--font-body); font-size:14px; line-height:1.6; }}
main {{ max-width:1120px; margin:0 auto; padding:32px 24px 80px; }}
h1 {{ font-size:28px; line-height:1.25; margin:0 0 6px; text-wrap:balance; font-weight:700; }}
h2 {{ font-size:20px; margin:44px 0 12px; padding-top:18px; border-top:1px solid var(--line); text-wrap:balance; }}
h3 {{ font-size:16px; margin:26px 0 6px; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }}
p {{ max-width:74ch; }}
.eyebrow {{ font-family:var(--font-mono); font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); }}
.meta {{ color:var(--dim); font-size:13px; display:flex; flex-wrap:wrap; gap:6px 18px; margin-top:8px; }}
.mono {{ font-family:var(--font-mono); font-variant-numeric:tabular-nums; }}
.verdict {{ background:var(--panel); border:1px solid var(--line-soft); border-left:4px solid var(--brand); padding:18px 22px; margin:22px 0; border-radius:12px; }}
.verdict .lead {{ font-size:17px; font-weight:500; margin:0 0 8px; max-width:none; }}
.verdict ul {{ margin:6px 0 0; padding-left:20px; }} .verdict li {{ margin:4px 0; }}
.kpis {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:18px 0; }}
.tile {{ background:var(--panel); border:1px solid var(--line-soft); border-radius:10px; padding:12px 14px; }}
.tile-n {{ font-family:var(--font-mono); font-size:24px; font-variant-numeric:tabular-nums; line-height:1.1; }}
.tile-n small {{ font-size:13px; color:var(--dim); }}
.tile-l {{ font-size:12px; color:var(--dim); margin-top:4px; }}
.tile.good .tile-n {{ color:var(--ok); }} .tile.warn .tile-n {{ color:var(--warn); }} .tile.bad .tile-n {{ color:var(--up); }}
.tablewrap {{ overflow-x:auto; border:1px solid var(--line-soft); border-radius:10px; background:var(--panel); }}
table {{ border-collapse:collapse; width:100%; font-size:13px; }}
th {{ text-align:left; font-weight:500; color:var(--dim); font-size:12px; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel2); }}
td {{ padding:9px 12px; border-bottom:1px solid var(--line-soft); vertical-align:top; }}
.group {{ background:var(--panel); border:1px solid var(--line-soft); border-radius:12px; padding:6px 18px 12px; margin:14px 0; }}
.gkey {{ display:inline-block; background:var(--brand); color:#fff; border-radius:6px; padding:0 8px; font-size:13px; }}
.gcount {{ color:var(--dim); font-size:13px; }}
.glead {{ color:var(--dim); margin:0 0 6px; }}
details.board {{ border-top:1px solid var(--line-soft); }}
details.board > summary {{ cursor:pointer; list-style:none; display:grid; grid-template-columns:76px 40px 1fr 28px; gap:12px; align-items:baseline; padding:9px 0; }}
details.board > summary::-webkit-details-marker {{ display:none; }}
.bid {{ color:var(--brand); }} .bpage {{ color:var(--hint); font-size:12px; }} .bname {{ font-weight:500; }} .bsize {{ color:var(--dim); font-size:12px; text-align:right; }}
.bbody {{ padding:2px 0 12px 88px; }}
.detail {{ white-space:pre-wrap; color:var(--dim); font-size:13px; max-width:none; }}
.files {{ margin-top:8px; font-family:var(--font-mono); font-size:11px; color:var(--hint); }}
ul.plain {{ padding-left:18px; }} ul.plain li {{ margin:5px 0; }}
.next li {{ margin:8px 0; }}
:focus-visible {{ outline:2px solid var(--brand); outline-offset:2px; }}
@media (max-width:640px) {{ details.board > summary {{ grid-template-columns:76px 1fr 28px; }} .bpage {{ display:none; }} .bbody {{ padding-left:0; }} }}
@media (prefers-reduced-motion: reduce) {{ * {{ scroll-behavior:auto; }} }}
</style>
<main>
<div class="eyebrow">DAOU.Athena · main {esc(head)} · 2026-09-07 · 4판(구현 4차 결과 · 최종)</div>
<h1>Athena Paper 정합 판정</h1>
<div class="meta"><span>Paper 파일 「Athena」 10페이지 444보드</span><span>전수 게이트 3종(카드·화면·카드미니)이 기준</span><span>어제 판정(c33ef0a) 이후 main 에 {esc(n_commits)}개 커밋</span></div>

<section class="verdict">
  <p class="lead">최종 판정: 앱은 Paper 「Athena」를 카드는 1:1로(96장 중 95장), 화면은 실측 라우트로(95장 중 91장 · 계약 14장 중 12장) 구현했다. 남은 7장은 코드로 닫을 수 없는 것만 남았다 — Paper 자신을 고쳐야 하는 것 4장(캡션 2 · 보드끼리 반대말 1 · 문 없는 칩 1), 잠긴 제품 결정과 Paper 가 반대말을 하는 것 2장, 창 모델·세션 구조를 바꿔야 하는 것 1장.</p>
  <ul>
<li><b>카드.</b> 96장 × 정적 6검사 + 런타임 4폭에서 95장 통과(3판 94, 2판 93, 1판 64). 15R0-2 는 이 머신에 Daki 가 없어 생긴 폴백 폰트 줄상자 2px 이었고, 폰트 metric override 로 보드 기하를 건드리지 않고 닫았다. 137X-2 는 Paper 가 「순위」 칩 하나에 보드 두 장(2VDA-0·32XM-0)을 매달아 문이 7개인데 상태 보드가 8장인 구조 그대로다 — 없는 칩을 지어 그리면 정적 텍스트 검사가 곧바로 빨개진다.</li>
<li><b>화면.</b> 109장(화면 95 + 계약 14) 중 103장이 래칫에 잠겼다. 4차가 그래프 07 정직성 상태(범례·노드 채움 = 확정성·이름 추정 캡션)를 실기능으로 세웠고 — 지난 회차의 「보드 03·04 와 충돌」 판정은 원장 재대조로 뒤집혔다 — 백테스트 10 의 오류 상태 절반을 세웠다. 3차의 새 화면·기능 8건(프로젝트 추가 대화상자 · 세션 작업공간 복원 · 출처→지도 5단계 · 미니 카드 도달 · 제어 제안 턴 A~E · 작업 설정 편집 폼 · 고침 이력·되돌리기 · entity 응답 패널)과 Paper 가 스스로 「화면이 아니다」라고 적은 8장의 role 이전은 그대로다.</li>
<li><b>계약.</b> 14장 중 12장의 계약 문장이 docs/architecture 에 실재한다. 2장은 Paper 캡션에 마침표 문장이 하나도 없어 추출기가 잴 것이 없다 — 코드가 아니라 Paper 캡션 한 줄이다.</li>
<li><b>카드미니.</b> 192장 중 19장 일치·77장 이탈은 그대로다. Paper 자신이 다른 보드 값을 섞은 10장(paper_cross_board)을 먼저 고쳐야 대장을 손댈 수 있다는 정본 규칙 때문에 손대지 않았다.</li>
<li><b>검증 방식.</b> 네 회차 모두 「구현 → 독립 검토(최대 3회, 재현 실측) → origin/main 푸시」를 묶음마다 반복했고, 스텁·예외 목록·게이트 완화로 초록을 만든 자리는 없다. 검토자가 되돌린 것 2건(32XM-0 재배치 → 레일이 죽는 것을 실측해 복원 · 503 을 「꺼짐」으로 단정하던 문구 → 원인 보존)이 그 증거다.</li>
</ul>
</section>

<section class="kpis" aria-label="게이트 요약">
  <div class="tile good"><div class="tile-n">{cardsrep["pass"]}<small> / {cardsrep["boards"]}</small></div><div class="tile-l">카드 — 정적 6검사 + 런타임 4폭 (3판 94 · 1판 64)</div></div>
  <div class="tile good"><div class="tile-n">{scr["pass"] - (scr["contract"] - scr["contract_fail"])}<small> / {scr["boards"] - scr["contract"]}</small></div><div class="tile-l">화면 — 라우트 실측 래칫 (3판 90 · 1판 8)</div></div>
  <div class="tile good"><div class="tile-n">{scr["contract"] - scr["contract_fail"]}<small> / {scr["contract"]}</small></div><div class="tile-l">계약 — 문장이 문서에 실재 (2판 10/12)</div></div>
  <div class="tile warn"><div class="tile-n">{mini["matched"]}<small> / {mini["paper_boards"]}</small></div><div class="tile-l">카드미니 — Paper 정정 대기 (paper_cross_board {mini["paper_cross_board"]})</div></div>
  <div class="tile"><div class="tile-n">{esc(n_commits)}</div><div class="tile-l">커밋 (병합 제외, c33ef0a 이후) — {type_html}</div></div>
</section>

<h2>세 회차 동안 main 에 올라간 것</h2>
<p>여섯 트랙이 각자 워크트리에서 「구현 → 독립 검토(최대 3회) → origin/main 병합·푸시」를 작업마다 반복했다. pre-push 훅(저장소 게이트 6종 + 단위 3,345개)이 모든 푸시에서 통과했다.</p>
<div class="tablewrap"><table><thead><tr><th>트랙</th><th>결과</th><th>내용</th></tr></thead><tbody>{tracks_html}</tbody></table></div>

<h2>남은 빨감 — 코드로 닫을 수 없는 7장</h2>
<p>각 보드의 설명은 그 보드를 맡은 구현자가 Paper 원장과 앱 코드를 실측해 남긴 기록 그대로다. 「스텁이나 예외 목록으로 초록을 만들지 않는다」는 규칙 아래 남은 것들이라, 열면 무엇이 없고 왜 임의로 정하지 않았는지가 적혀 있다.</p>
{groups_html}

<h2>구현 3차·4차에서 닫힌 {len(closed3)}장</h2>
<p>2판에서 「구현 결정」·「Paper 정정」·「카드 결정」 갈래에 있던 보드 중 사용자 결정 없이 Paper 대로 세울 수 있던 것들이다. 오른쪽 글자는 트랙(A parity 3차 · B gates 3차 · C parity 4차). 설명은 구현자가 마지막 검토를 통과한 뒤 남긴 기록 그대로다.</p>
<section class="group">{closed3_html}</section>

<h2>통과했지만 Paper 가 더 그린 것이 있는 {len(partial)}장</h2>
<p>라우트는 통과하지만 Paper 보드가 앱보다 더 그린 조각(구역 이름·각주·도구 이름 표기 등)이 있다. 게이트 수치에는 안 잡히므로 따로 적어 둔다.</p>
<section class="group">{partial_html}</section>

<h2>다음 — 사용자가 정할 7가지</h2>
<ol class="next">
<li><b>1XA2-0 · 2DZE-0</b> — Paper 보드에 계약 캡션 한 줄(마침표 문장)을 적는다. 코드·문서는 이미 있다.</li>
<li><b>2GZM-2</b> — 보드 10 의 프리셋 고르기 화면과 보드 19 의 「프리셋이라는 구분은 없습니다」 중 어느 쪽이 정본인지 Paper 에서 정한다. 오류 상태 절반은 이미 앱에 있다.</li>
<li><b>2I7Z-2</b> — 키우미 얼굴 1종(2026-09-01 결정)을 유지할지, Paper 대로 모드별 다섯 얼굴로 갈지.</li>
<li><b>3KM-0</b> — 빈 캔버스 문구 회전(2026-08-27 결정)·「성향 그래프 열기」 CTA 삭제를 유지할지, Paper 10 대로 되돌릴지.</li>
<li><b>3W9B-1</b> — 상주 세션 하나·창 2개(셸+오브) 구조를 동시 3실행·대기열·두 셸 창으로 바꿀지(크기 L, 창 모델 게이트 재정의 포함).</li>
<li><b>137X-2</b> — Paper 에 신주인수권(32XM-0)으로 가는 칩을 그릴지, 아니면 32XM-0 을 137X-2 레일에서 떼어 별도 진입으로 둘지.</li>
<li><b>카드미니</b> — Paper 에서 paper_cross_board 10장을 고친 뒤 verify:paper-mini 를 다시 돌린다.</li>
</ol>
</main>
'''
out = f'{SP}/athena-paper-parity-verdict.html'
open(out, 'w', encoding='utf-8', newline='\n').write(page)
print('written', out, len(page), 'bytes; head', head, 'commits', n_commits)

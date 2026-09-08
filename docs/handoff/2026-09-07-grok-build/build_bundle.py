"""Snapshot the frozen handoff; no product files are modified."""
from pathlib import Path
import collections
import datetime
import hashlib
import json
import shutil
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ART = ROOT / '.omc/artifacts/full-review'

def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def write(p, value):
    Path(p).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

head = git('rev-parse', 'HEAD').decode().strip()
assert head == 'ac4938008690a86e19c22e2c2d612db11aa52b03', 'Reconcile changed baseline before rebuilding'
owned = [
    'app/chat.js', 'app/lib/agent-canvas.js', 'app/lib/agent-canvas.test.js',
    'app/lib/watch-check-card.js', 'app/lib/watch-check-card.test.js',
    'app/lib/watch-check-card-render.test.js', 'app/shell.html',
    'app/scripts/run-verify-suite.js', 'app/scripts/run-verify-suite.test.js',
]
for name in ['obs077-078-execution.json', 'verify-suite-evidence-execution.json']:
    for p, expected in read(ART/name)['sha256'].items():
        assert sha(ROOT/p) == expected, f'Writer snapshot changed: {p}'

(HERE/'wip').mkdir(exist_ok=True)
(HERE/'wip/tracked.patch').write_bytes(git('diff', '--binary', 'HEAD', '--', *owned))
for p in owned:
    target = HERE/'wip/files'/p
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT/p, target)
write(HERE/'WORKING-TREE.json', {
    'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'head': head, 'branch': 'main', 'remote_head_at_capture': head,
    'product_status': '9 WIP files frozen; author-tested, independent approval pending',
    'git_status': git('status', '--short', '--branch').decode(),
    'files': [{'path': p, 'sha256': sha(ROOT/p), 'new': p.endswith('watch-check-card-render.test.js')} for p in owned],
    'patch': 'wip/tracked.patch', 'new_file_transport': 'wip/files/app/lib/watch-check-card-render.test.js',
})

selected = [
    'code-audit.json','paper-audit-a.json','paper-audit-b.json',
    'obs077-078-execution.json','obs077-078-red-final.log','obs077-payload-red.log','obs077-078-green-final.log',
    'verify-suite-evidence-execution.json','verify-suite-evidence-plan.json','verify-suite-evidence-red.log',
    'verify-suite-evidence-green.log','verify-suite-evidence-cli.stdout.log','verify-suite-evidence-cli.stderr.log',
    'backend-integrated-execution.json','backend-integrated.log',
    'integrated-PAPER-SCREENS.json','integrated-PAPER-CARDS.json','integrated-PAPER-MINI.json',
    'paper-integrated.stdout.log','paper-integrated.stderr.log','paper-access.json',
    'runtime-card-coverage.json','runtime-card-coverage.stderr.log','board-slots.json','board-slots.log',
    'pr25-integration.json','pr25-app-unit.log','pr25-kiumi.stdout.log','pr25-kiumi.stderr.log',
    'pr25-architecture-review.json','pr25-compute-layout.json','pr25-window-placement-review.log','pr25-push.log',
    'code047-redaction-execution.json','code047-independent-review.json',
    'backtest-completed-state-execution.json','code-review-clear-state.log','backtest-completed-state-architect.log',
    'mini-template-outbox.stdout.log','mini-template-outbox.stderr.log','mini-harness-architect.log',
    'code-audit-contract-tests.log','code-audit-ui-final.log','code-audit-boundaries.json','code-audit-boundaries.log','verify-code-audit-boundaries.js',
    'paper-audit-a-tests.log','paper-audit-a-entity-tests.log','paper-audit-b-card-tests.log','paper-audit-b-backtest-tests.log',
]
index=[]
(HERE/'evidence').mkdir(exist_ok=True)
for name in selected:
    source=ART/name
    assert source.is_file(), name
    target=HERE/'evidence'/name
    shutil.copy2(source,target)
    index.append({'source':source.relative_to(ROOT).as_posix(),'copy':target.relative_to(HERE).as_posix(),'sha256':sha(target)})
for name in ['prd.json','ralph-state.json','progress.txt']:
    source=ROOT/'.omc/state/sessions/01a07a31-b2ff-7a30-9263-4c52f72f7231'/name
    target=HERE/'evidence'/('session-'+name)
    shutil.copy2(source,target)
    index.append({'source':source.relative_to(ROOT).as_posix(),'copy':target.relative_to(HERE).as_posix(),'sha256':sha(target)})
write(HERE/'EVIDENCE-INDEX.json', index)

# Separate audit scope, preserved verbatim with its own historical timestamps.
related=HERE/'related-market-audit'
related.mkdir(exist_ok=True)
for source in (ROOT/'docs/audits/market-session-20260907').glob('*.md'):
    shutil.copy2(source,related/source.name)

historical=read(ROOT/'docs/handoff/2026-09-07-codex-resume/historical-findings.json')
original={r['id']:r for group in [historical['code']['confirmed'],historical['paper']['confirmed'],historical['paper']['observations']] for r in group}
records=[]
for filename in ['code-audit.json','paper-audit-a.json','paper-audit-b.json']:
    for item in read(ART/filename)['findings']:
        r=dict(item)
        r['historical']=original[r['id']]
        r.setdefault('title',r['historical'].get('title',r['id']))
        r['audit_file']='evidence/'+filename
        r['audit_status']=r['status']
        r['handoff_status']=r['status']
        if r['id']=='CODE-047':
            r['handoff_status']='fixed'
            r['follow_up']={'commit':'e9f9c5d0b2df7c673c102cfb632616e9e86df62f','evidence':'evidence/code047-independent-review.json','reason':'Tracked exposure masked and independently checked; Git historical content remains. Author execution committed:false is historical, not current Git state.'}
        if r['id'] in ['CODE-039','CODE-075','OBS-077','OBS-078']:
            r['handoff_status']='implemented_pending_review'
            r['follow_up']={'evidence':'evidence/'+('verify-suite-evidence-execution.json' if r['id'].startswith('CODE') else 'obs077-078-execution.json'),'reason':'Frozen uncommitted WIP; author tests passed; independent review and applicable integrated validation pending. Not closed.'}
        records.append(r)
assert len(records)==342 and len({r['id'] for r in records})==342
assert set(original)=={r['id'] for r in records}
totals=dict(collections.Counter(r['handoff_status'] for r in records))
payload={'head':head,'scope':'81 CODE + 52 PAPER + 209 OBS; historical refuted lists retained in original repo but excluded from these342 re-audited entries','audit_counts':dict(collections.Counter(r['audit_status'] for r in records)),'handoff_counts':totals,'warning':'Statuses apply to exact claims, not whole-board completeness; counts include overlapping causes. Follow-up overlays never mutate original audits.','findings':records}
write(HERE/'ALL-FINDINGS.json',payload)

lines=['# 전수 인계 원장 — 342개 항목','',f'기준 커밋 `{head}`. 현재 상태 집계: '+json.dumps(totals,ensure_ascii=False),'','`implemented_pending_review`는 미완료다. 원본 감사의 fixed는 해당 주장 범위의 판정이며 실제 화면 전체 승인과 다르다. CODE047의 후속 마스킹 및 WIP4항목은 별도 overlay다.','', '## 빠른 색인','', '| ID | 인계 상태 | 제목 |','|---|---|---|']
for r in records:
    title=str(r['title']).replace('|','/').replace('\n',' ')
    lines.append(f"| [{r['id']}](#{r['id'].lower()}) | {r['handoff_status']} | {title} |")
for r in records:
    lines += ['',f"## {r['id']}",'',f"**{r['title']}**",'',f"- 원본 감사: `{r['audit_status']}` → 인계 상태: **`{r['handoff_status']}`**",f"- 원본 감사 파일: [{r['audit_file']}]({r['audit_file']})"]
    if r.get('board'): lines.append(f"- 관련 보드: `{r['board']}`")
    for key,label in [('reason','판정 이유'),('verification','검증 범위'),('limitation','한계'),('uncertainty','불확실성')]:
        if r.get(key): lines += ['',f'**{label}**', '',str(r[key])]
    if r.get('locations'): lines += ['', '**현재 소스 위치**','', '\n'.join(f'- `{p}:{n}`' for p,n in r['locations'])]
    ev=r.get('evidence')
    lines += ['', '**현재 근거**','']
    if isinstance(ev,str): lines.append(ev)
    elif isinstance(ev,list):
        for e in ev:
            if isinstance(e,dict):
                lines += [f"- `{e.get('file','')}:{e.get('line','')}` — {e.get('level','source')}"]
                if e.get('excerpt'): lines += ['','```text',str(e['excerpt']).rstrip(),'```','']
            else: lines.append('- '+str(e))
    if r.get('tests'): lines += ['', '**감사에서 연결한 테스트**','', '\n'.join('- '+str(t) for t in r['tests'])]
    if r.get('follow_up'): lines += ['', '**감사 이후 변경 — 원본 판정과 구분**','',json.dumps(r['follow_up'],ensure_ascii=False,indent=2)]
    lines += ['', '<details><summary>원래 발견 내용과 원본 주장</summary>','','```json',json.dumps(r['historical'],ensure_ascii=False,indent=2),'```','','</details>']
(HERE/'ALL-FINDINGS.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
(HERE/'START-HERE.txt').write_text('''DAOU.Athena 코드 검수를 이어받아 주세요. 먼저 이 묶음의 README.md와 WORKING-TREE.json, ALL-FINDINGS.md를 읽고 현 Git 상태를 확인하세요.
기준은 main ac4938008690a86e19c22e2c2d612db11aa52b03입니다. 열린 PR은0개였습니다. 미커밋 제품/테스트9개는 실패 때문에 버린 코드가 아니라 작성자 테스트까지 끝난 독립검토 대기 WIP입니다. 같은 로컬 작업공간에서는 patch를 중복 적용하지 마세요.
WIP-A: OBS077/078 감시 채팅 결과/설정 Data행7파일, 195/195 작성자검사통과. WIP-B: CODE039/075 실행별증거 runner2파일, 31/31+offline CLI통과. 먼저 비작성자 검토와 현 소스 통합검증을 하고 반영하세요.
342개 전수원장의 원본 감사와 후속 overlay를 구분하세요. Paper source-blocked/사용자선택은 임의확정하지 마세요. 전체검수는 아직 끝나지 않았습니다.
다음은 2FR9 코드흐름0노드,137X/2R3M 단위·레이블중복/state문제,4TY 명칭불일치,XI흔들림,live-full false-green/실프로필/캡처stub를 우선확인하세요. 이후 ALL-FINDINGS의 모든 남은 항목을 정확한근거로 처리하세요.
현재단계는 인수인계입니다. 원본/계좌/프로필/의존성/다른worktree를 삭제하지 말고,실주문·실모델을 테스트대용으로 실행하지 마세요. 각완료주장에는 현재커밋/소스해시/검증로그/독립리뷰를 붙이세요.
''',encoding='utf-8')

files=[p for p in HERE.rglob('*') if p.is_file() and p.name!='MANIFEST.json']
write(HERE/'MANIFEST.json', {'head':head,'files':[{'path':p.relative_to(HERE).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(files)]})
archive=HERE.parent/(HERE.name+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(HERE.rglob('*')):
        if p.is_file(): z.write(p,arcname=HERE.name+'/'+p.relative_to(HERE).as_posix())
print(json.dumps({'findings':len(records),'handoff_counts':totals,'evidence_files':len(index),'wip_files':len(owned),'archive':str(archive),'archive_bytes':archive.stat().st_size},ensure_ascii=False))

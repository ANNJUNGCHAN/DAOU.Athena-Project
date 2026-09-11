"""Populate the three explicitly owned Paper boards, one visual group per call."""
import sys, json, re, html
from pathlib import Path
from paper_rpc import rpc

FILE = '01M22GG877DW4N96CGABTKJTAH'
BOARDS = ['N5-0', '163-0', '199-0']
POSTS = ['01-tool-selection', '02-investment-memory', '03-graph-retrieval']
ROOT = Path(__file__).resolve().parents[1]

def call(name, **args):
    result = rpc('tools/call', {'name': name, 'arguments': {'fileId': FILE, **args}})
    if result.get('error') or result.get('result', {}).get('isError'):
        raise RuntimeError(result)
    return result

def insert(board, content):
    return call('write_html', targetNodeId=board, mode='insert-children', html=content)

def plain(text):
    text = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'\[\^\d+\]', '', text)
    return html.escape(text.replace('*', '').replace('`', '').strip())

def section_parts(section):
    """Return title and body paragraphs without Markdown footnote definitions."""
    section = re.split(r'^\[\^\d+\]:', section, maxsplit=1, flags=re.M)[0]
    lines = section.splitlines()
    title = plain(lines[0])
    paragraphs = [
        p for p in '\n'.join(lines[1:]).split('\n\n')
        if p.strip() and not p.strip().startswith(('![', '*현재', '*평가'))
    ]
    return title, paragraphs

def footnotes(markdown):
    matches = re.findall(
        r'^\[\^(\d+)\]:\s*(.*?)(?=\n\n\[\^\d+\]:|\Z)',
        markdown,
        flags=re.M | re.S,
    )
    return [(number, plain(body.replace('\n', ' '))) for number, body in matches]

phase = sys.argv[1]
for i, (board, post) in enumerate(zip(BOARDS, POSTS)):
    if phase == 'trial-copy' and i != 0:
        continue
    md = (ROOT / (post + '.md')).read_text(encoding='utf-8-sig')
    if phase == 'header':
        call('update_styles', updates=[{'nodeIds':[board], 'styles':{'left':f'{i*1520}px','top':'0px','height':'fit-content','display':'flex','flexDirection':'column','paddingBottom':'80px'}}])
        insert(board, '<div layer-name="Brand navigation" style="display:flex;align-items:center;justify-content:space-between;width:1440px;height:72px;padding:16px 56px;border-bottom:1px solid #EEF0F4;font-family:Daki,sans-serif;color:#14171D"><div style="font-size:28px;color:#0E20B2">ATHENA</div><div style="font-size:16px">Engineering · 투자 AI의 작동 원리</div></div>')
        title = plain(md.splitlines()[0].lstrip('# '))
        insert(board, f'<div layer-name="Editorial hero" style="display:flex;flex-direction:column;align-items:center;gap:28px;width:1440px;padding:88px 120px 72px;color:#14171D;font-family:Daki,sans-serif"><div style="color:#0E20B2;font-size:18px">ATHENA ENGINEERING · 0{i+1} / 03</div><div style="font-family:Daki Title,Daki,sans-serif;font-size:64px;line-height:1.25;letter-spacing:-2px;text-align:center;width:1080px">{title}</div><div style="display:flex;gap:12px"><div style="padding:13px 24px;background:#14171D;color:white;border-radius:40px;font-size:17px">현재 구현</div><div style="padding:13px 24px;background:#F4F5F8;border-radius:40px;font-size:17px">논문과 비교 · 측정 계획</div></div></div>')
    elif phase == 'tech-hero':
        response = call('get_children', nodeId=board)
        children = json.loads(response['result']['content'][0]['text'])['children']
        hero = next(n['id'] for n in children if n['name'] == 'Editorial hero')
        title = ['ATHENA Tool Use', 'Agentic Memory for ATHENA', 'RAG for ATHENA'][i]
        subtitle = ['조건을 확인하며 금융 도구를 고르는 방법', '출처를 보존하며 투자 기억을 쌓는 방법', '이름과 관계에서 답변의 근거를 찾는 방법'][i]
        terms = [['Tool Routing', 'Schema Validation', 'First-valid Hedging'], ['Structured Extraction', 'Provenance', 'Prompt Fingerprint Cache'], ['BM25 Retrieval', 'Graph Traversal', 'Evidence Grounding']][i]
        chips = ''.join(f'<div style="padding:13px 20px;background:#F4F5F8;border-radius:40px;font-size:17px">{term}</div>' for term in terms)
        call('write_html', targetNodeId=hero, mode='replace', html=f'<div layer-name="Editorial hero" style="display:flex;flex-direction:column;align-items:center;gap:28px;width:1440px;padding:88px 120px 72px;color:#14171D;font-family:Daki,sans-serif"><div style="color:#0E20B2;font-size:18px">ATHENA ENGINEERING · 0{i+1} / 03</div><div style="font-family:Daki Title,Daki,sans-serif;font-size:68px;line-height:1.25;text-align:center;width:1200px">{title}</div><div style="font-size:25px;color:#626B76">{subtitle}</div><div style="display:flex;gap:12px">{chips}</div></div>')
    elif phase in ('sync-copy', 'trial-copy', 'sync-tool-copy'):
        if phase == 'sync-tool-copy' and i != 0:
            continue
        response = call('get_children', nodeId=board)
        children = json.loads(response['result']['content'][0]['text'])['children']
        sections = re.split(r'^## ', md, flags=re.M)[1:]
        if len(sections) != 4:
            raise ValueError('Unexpected section count')
        existing_section_count = 3 if i == 0 else 4
        for k, section in enumerate(sections[:existing_section_count]):
            title, paragraphs = section_parts(section)
            if phase == 'trial-copy':
                blocks = []
                for p in '\n'.join(lines[1:]).split('\n\n'):
                    p = p.strip()
                    if not p or p.startswith(('*현재', '*평가')):
                        continue
                    if p.startswith('!['):
                        if 'toolrerank-figure-2-original.png' in p:
                            blocks.append('<img src="paper-asset:///C:/Projects/DAOU.Athena/docs/blog/athena-ai/assets/toolrerank-figure-2-original.png" style="width:1200px;height:537px;object-fit:contain" />')
                        continue
                    if 'Zheng et al.' in p and 'Figure 2' in p:
                        blocks.append(f'<div style="font-size:17px;line-height:1.6;color:#626B76">{plain(p)}<br/>https://aclanthology.org/2024.lrec-main.1413/ · https://creativecommons.org/licenses/by-nc/4.0/</div>')
                    else:
                        blocks.append(f'<div style="font-size:22px;line-height:1.65;color:#626B76">{plain(p)}</div>')
                body = ''.join(blocks)
            else:
                body = ''.join(f'<div style="font-size:22px;line-height:1.65;color:#626B76">{plain(p)}</div>' for p in paragraphs)
            node = next(n['id'] for n in children if n['name'] == f'Section {k+1} explanation')
            heading_size = '30px' if i == 0 and k == 2 else '34px'
            call('write_html', targetNodeId=node, mode='replace', html=f'<div layer-name="Section {k+1} explanation" style="display:flex;flex-direction:column;gap:20px;width:1440px;padding:36px 120px 28px;font-family:Daki,sans-serif"><div style="font-family:Daki Title,Daki,sans-serif;font-size:{heading_size};line-height:1.35;color:#14171D">{title}</div>{body}</div>')
        source = next(n['id'] for n in children if n['name'] == 'Sources')
        refs = ['ToolRerank · LREC-COLING 2024', '투자 기억의 구조화 추출과 출처 관리', '그래프 관계와 근거 검색'][i]
        if i == 0:
            outcome_title, outcome_paragraphs = section_parts(sections[3])
            outcome_body = ''.join(f'<div style="font-size:22px;line-height:1.65;color:#626B76">{plain(p)}</div>' for p in outcome_paragraphs)
            note_cards = ''.join(
                f'<div layer-name="Term note {number}" style="display:flex;flex-direction:column;gap:10px;width:580px;padding:24px;background:#FFFFFF;border:1px solid #EEF0F4;border-radius:20px"><div style="font-size:18px;color:#0E20B2">NOTE {number}</div><div style="font-size:18px;line-height:1.65;color:#626B76">{body}</div></div>'
                for number, body in footnotes(md)
            )
            source_html = f'<div layer-name="Sources" style="display:flex;flex-direction:column;width:1440px;font-family:Daki,sans-serif"><div layer-name="Section 4 explanation" style="display:flex;flex-direction:column;gap:20px;width:1440px;padding:48px 120px"><div style="font-family:Daki Title,Daki,sans-serif;font-size:34px;line-height:1.35;color:#14171D">{outcome_title}</div>{outcome_body}</div><div layer-name="Technical notes" style="display:flex;flex-direction:column;gap:20px;width:1440px;padding:44px 120px"><div style="font-family:Daki Title,Daki,sans-serif;font-size:30px;color:#14171D">기술 용어 자세히 보기</div><div style="display:flex;flex-wrap:wrap;gap:20px;width:1200px">{note_cards}</div></div></div>'
        else:
            source_html = f'<div layer-name="Sources" style="display:flex;flex-direction:column;gap:12px;width:1440px;padding:32px 120px;border-top:1px solid #EEF0F4;font-family:Daki,sans-serif;font-size:18px;color:#626B76"><div>{refs}</div><div>2026.09.10 코드 검토 기준 · 현재 구현과 연구 후보를 구분합니다. 성능 평가는 아직 미측정입니다.</div></div>'
        call('write_html', targetNodeId=source, mode='replace', html=source_html)
    elif phase == 'hero-fix':
        response = call('get_children', nodeId=board)
        children = json.loads(response['result']['content'][0]['text'])['children']
        hero = next(n['id'] for n in children if n['name'] == 'Editorial hero')
        lines = [('조건을 확인하며', '금융 도구를 고르는 방법'), ('출처를 보존하며', '투자 기억을 쌓는 방법'), ('관계와 원문으로', '투자 기억을 다시 찾는 방법')][i]
        call('write_html', targetNodeId=hero, mode='replace', html=f'<div layer-name="Editorial hero" style="display:flex;flex-direction:column;align-items:center;gap:28px;width:1440px;padding:88px 120px 72px;color:#14171D;font-family:Daki,sans-serif"><div style="color:#0E20B2;font-size:18px">ATHENA ENGINEERING · 0{i+1} / 03</div><div style="display:flex;flex-direction:column;align-items:center;font-family:Daki Title,Daki,sans-serif;font-size:64px;line-height:1.25;letter-spacing:-2px;width:1200px"><div>{lines[0]}</div><div>{lines[1]}</div></div><div style="display:flex;gap:12px"><div style="padding:13px 24px;background:#14171D;color:white;border-radius:40px;font-size:17px">현재 구현</div><div style="padding:13px 24px;background:#F4F5F8;border-radius:40px;font-size:17px">논문과 비교 · 측정 계획</div></div></div>')
    elif phase == 'reset-section-one':
        response = call('get_children', nodeId=board)
        children = json.loads(response['result']['content'][0]['text'])['children']
        owned = [n['id'] for n in children if n['name'] in ['Section 1 explanation', f'Figure {i*4+1:02}']]
        if owned:
            call('delete_nodes', nodeIds=owned)
    elif phase.isdigit():
        k = int(phase)
        section = re.split(r'^## ', md, flags=re.M)[k+1]
        lines = section.splitlines()
        title = plain(lines[0])
        paragraphs = [p for p in '\n'.join(lines[1:]).split('\n\n') if p.strip() and not p.strip().startswith(('![','*현재','*평가'))]
        body = ''.join(f'<div style="font-size:22px;line-height:1.65;color:#626B76">{plain(p)}</div>' for p in paragraphs)
        insert(board, f'<div layer-name="Section {k+1} explanation" style="display:flex;flex-direction:column;gap:20px;width:1440px;padding:36px 120px 28px;font-family:Daki,sans-serif"><div style="font-family:Daki Title,Daki,sans-serif;font-size:34px;line-height:1.35;color:#14171D">{title}</div>{body}</div>')
        svg = (ROOT / 'assets' / f'beginner-{i*4+k+1:02}.svg').read_text(encoding='utf-8-sig')
        svg = re.sub(r'<\?xml.*?\?>', '', svg).strip()
        insert(board, f'<div layer-name="Figure {i*4+k+1:02}" style="display:flex;width:1440px;padding:0px 120px 36px">{svg}</div>')
    elif phase == 'footer':
        refs = ['ToolRerank · LREC-COLING 2024', 'A-MEM · arXiv:2502.12110', 'HippoRAG · arXiv:2405.14831']
        insert(board, f'<div layer-name="Sources" style="display:flex;flex-direction:column;gap:12px;width:1440px;padding:32px 120px;border-top:1px solid #EEF0F4;font-family:Daki,sans-serif;font-size:18px;color:#626B76"><div>비교 논문 · {refs[i]}</div><div>2026.09.10 코드 검토 기준 · 도식은 구현 설명용 예시입니다. 평가 결과는 아직 측정하지 않았습니다.</div></div>')
    print(json.dumps({'board':board, 'phase':phase, 'ok':True}), flush=True)

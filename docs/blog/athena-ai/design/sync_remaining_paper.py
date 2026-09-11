"""Sync the memory and retrieval articles into their existing Paper boards."""
import html
import json
import re
from pathlib import Path
from paper_rpc import rpc

ROOT = Path(__file__).resolve().parents[1]
FILE = '01M22GG877DW4N96CGABTKJTAH'

def call(name, **arguments):
    response = rpc('tools/call', {'name': name, 'arguments': {'fileId': FILE, **arguments}})
    if response.get('error') or response.get('result', {}).get('isError'):
        raise RuntimeError(response)
    return response['result']

def text(value):
    value = re.sub(r'\[([^]]+)\]\(([^)]+)\)', r'\1', value)
    value = re.sub(r'\[\^(\d+)\]', r'[\1]', value)
    return html.escape(value.replace('**', '').replace('`', '').strip())

for board, slug, last_figure, lead in [
    ('163-0', '02-investment-memory', 8, '대화와 투자 기록을 출처가 있는 기억으로 정리하는 방법'),
    ('199-0', '03-graph-retrieval', 12, '질문에서 대상을 찾고, 관계와 원문을 답변의 근거로 연결하는 방법'),
]:
    md = (ROOT / f'{slug}.md').read_text(encoding='utf-8-sig')
    notes = re.findall(r'^\[\^(\d+)\]:\s*(.+)$', md, flags=re.M)
    body = re.sub(r'^\[\^\d+\]:.*$', '', md, flags=re.M)
    sections = re.split(r'^## ', body, flags=re.M)[1:]
    if len(sections) != 4:
        raise ValueError(f'{slug}: expected four sections')
    children = json.loads(call('get_children', nodeId=board)['content'][0]['text'])['children']
    by_name = {node['name']: node['id'] for node in children}
    modes = md.splitlines()[2].split(' | ')
    chips = ''.join(f'<div style="padding:10px 18px;border:1px solid #EEF0F4;border-radius:40px;font-size:17px;color:#0E20B2">{text(mode)}</div>' for mode in modes)
    title = text(md.splitlines()[0].lstrip('# '))
    call('write_html', targetNodeId=by_name['Editorial hero'], mode='replace', html=f'<div layer-name="Editorial hero" style="display:flex;flex-direction:column;align-items:center;gap:28px;width:1440px;padding:88px 120px 72px;font-family:Daki,sans-serif;color:#14171D"><div style="font-family:Daki Title,Daki,sans-serif;font-size:68px;line-height:1.25;text-align:center;width:1200px">{title}</div><div style="font-size:25px;color:#626B76">{lead}</div><div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;width:1200px">{chips}</div></div>')
    for number, section in enumerate(sections, 1):
        heading, _, content = section.partition('\n')
        paragraphs = [p.strip() for p in content.split('\n\n') if p.strip() and not p.strip().startswith('![')]
        blocks = ''.join(f'<div style="font-size:22px;line-height:1.65;color:#626B76">{text(p)}</div>' for p in paragraphs)
        call('write_html', targetNodeId=by_name[f'Section {number} explanation'], mode='replace', html=f'<div layer-name="Section {number} explanation" style="display:flex;flex-direction:column;gap:20px;width:1440px;padding:36px 120px 28px;font-family:Daki,sans-serif"><div style="font-family:Daki Title,Daki,sans-serif;font-size:34px;line-height:1.35;color:#14171D">{text(heading)}</div>{blocks}</div>')
    if f'Figure {last_figure:02}' in by_name:
        call('delete_nodes', nodeIds=[by_name[f'Figure {last_figure:02}']])
    note_blocks = ''.join(f'<div style="font-size:18px;line-height:1.65;color:#626B76">[{number}] {text(content)}</div>' for number, content in notes)
    call('write_html', targetNodeId=by_name['Sources'], mode='replace', html=f'<div layer-name="Sources" style="display:flex;flex-direction:column;gap:24px;width:1440px;padding:44px 120px;font-family:Daki,sans-serif"><div style="font-family:Daki Title,Daki,sans-serif;font-size:30px;color:#14171D">기술 용어 자세히 보기</div>{note_blocks}</div>')
    call('finish_working_on_nodes', nodeIds=[board])
    print(json.dumps({'board': board, 'sections': len(sections), 'notes': len(notes), 'synced': True}), flush=True)

"""Replace existing blog figure frames without moving the article boards."""
import json
from pathlib import Path
from paper_rpc import rpc

ROOT = Path(__file__).resolve().parents[1]
FILE = '01M22GG877DW4N96CGABTKJTAH'

def call(name, **arguments):
    response = rpc('tools/call', {'name': name, 'arguments': {'fileId': FILE, **arguments}})
    if response.get('error') or response.get('result', {}).get('isError'):
        raise RuntimeError(response)
    return response['result']

for board, figures in [('N5-0', range(1, 4)), ('163-0', range(5, 8)), ('199-0', range(9, 12))]:
    result = call('get_children', nodeId=board)
    children = json.loads(result['content'][0]['text'])['children']
    for number in figures:
        name = f'Figure {number:02}'
        target = next(node['id'] for node in children if node['name'] == name)
        asset = ROOT / 'assets' / f'beginner-{number:02}-static.svg'
        if not asset.exists():
            asset = ROOT / 'assets' / f'beginner-{number:02}.svg'
        svg = asset.read_text(encoding='utf-8-sig')
        call('write_html', targetNodeId=target, mode='replace', html=f'<div layer-name="{name}" style="display:flex;width:1440px;padding:0px 120px 36px">{svg}</div>')
    call('finish_working_on_nodes', nodeIds=[board])
    print(json.dumps({'board': board, 'figures': list(figures), 'synced': True}), flush=True)

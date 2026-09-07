"""Offline PyYAML producer and independently supplied title corpus verification.

Run from backend: .venv/Scripts/python.exe ../.omc/artifacts/2026-09-07-source-yaml-boundary/verify-boundary.py
"""
import json
import random
import shutil
import subprocess
from pathlib import Path

import yaml

from athena_api.backtest import source_to_map as sm, visual_schema

folder = Path(__file__).resolve().parent
root = folder.parents[4]
rules = sm.extract_rules('진입: 종가가 20일 최고가를 넘는 날\n청산: 20일 이동평균 아래로 마감\n손절: 진입가 -5%')
words = ('word ' * 40).strip()
names = ['short', words, "TITLE: user's " + words, 'TITLE\t' + words,
         'TITLE\x00' + words, 'TITLE\x7f' + words, 'TITLE\x85' + words,
         'TITLE\xa0' + words, 'TITLE\u2028' + words, 'TITLE\u2029' + words,
         'TITLE\n' + words, 'TITLE\n\n' + words, 'TITLE\n #comment-like ' + words,
         'TITLE ' + words + '\nend', 'TITLE\n ' + words, ' TITLE ' + words + ' ',
         'TITLE ' + words + '\\', 'TITLE\\"' + words,
         'TITLE ' + ('two  spaces ' * 20), 'TITLE ' + ('💡 word ' * 25)]
producer = [{'title': s, 'yaml': visual_schema.spec_to_yaml(sm.spec_from_rules(rules, name=s))}
            for s in names]
rng = random.Random(29)
parts = ['hello', 'world', '한글', '\n', '\n\n', '  ', "'", '"', '\\', ': ',
         ' # ', '\t', '\x85', '\u2028', '\u2029', '😊', '\0', '  tail']
fuzz = []
for _ in range(400):
    name = ''.join(rng.choice(parts) for _ in range(rng.randrange(1, 65)))
    doc = {'version': '1.0', 'metadata': {'name': name, 'tags': []},
           'strategy': {'id': 'from_source', 'category': 'source',
                        'params': {'period': {'default': 20, 'type': 'int'}},
                        'indicators': [{'id': 'SMA', 'alias': 'ma20',
                                        'params': {'period': '$period'}}]},
           'risk': {'stop_loss': {'enabled': True, 'percent': 5.0}}}
    fuzz.append({'title': name, 'yaml': yaml.safe_dump(doc, allow_unicode=True, sort_keys=False)})
script = """
const fs = require('node:fs');
const canvas = require('./app/lib/backtest-canvas');
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map((sample, i) => {
  const doc = canvas.parseYamlBlock(sample.yaml);
  return { i, equalName: doc.metadata?.name === sample.title,
    sourceId: doc.strategy?.id, hasRisk: doc.risk?.stop_loss?.percent === 5,
    got: doc.metadata?.name };
})));
"""
failed_count = 0
for label, cases in [('producer-corpus', producer), ('reviewer-corpus', fuzz)]:
    run = subprocess.run([shutil.which('node'), '-e', script], cwd=root,
                         input=json.dumps(cases), capture_output=True, text=True,
                         encoding='utf-8', check=True)
    results = json.loads(run.stdout)
    failed = [dict(r, expected=cases[r['i']]['title'], yaml=cases[r['i']]['yaml'])
              for r in results if not r['equalName'] or r.get('sourceId') != 'from_source'
              or not r['hasRisk']]
    (folder / (label + '.json')).write_text(
        json.dumps({'count': len(cases), 'failed': failed, 'results': results},
                   ensure_ascii=True, indent=2), encoding='utf-8', newline='\n')
    print(json.dumps({'corpus': label, 'count': len(cases), 'failures': len(failed),
                      'failed': failed}, ensure_ascii=True))
    failed_count += len(failed)
raise SystemExit(bool(failed_count))

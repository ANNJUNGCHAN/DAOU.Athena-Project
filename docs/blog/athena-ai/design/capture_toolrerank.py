"""Render the published Figure 2 without redrawing or changing its contents."""
import urllib.request
from pathlib import Path
import fitz
import json

url = 'https://aclanthology.org/2024.lrec-main.1413.pdf'
document = fitz.open(stream=urllib.request.urlopen(url, timeout=40).read(), filetype='pdf')
page = document[2]
print('Page size:', page.rect)
for block in page.get_text('blocks'):
    if block[1] < 350:
        print(json.dumps([tuple(round(x, 1) for x in block[:4]), block[4][:160].replace('\n', ' ')]))
output = Path(__file__).resolve().parents[1] / 'assets'
page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=fitz.Rect(75, 60, 522, 260)).save(output / 'toolrerank-figure-2-original.png')
print('First-page license:', document[0].get_text()[-600:].encode('ascii', 'backslashreplace').decode())

# IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
# -*- coding: utf-8 -*-
"""doctext.py — PDF 의 글자를 stdout(UTF-8)으로. 종료코드 3 = 이 파이썬에 pypdfium2 가 없음. 쓰는 곳 = doctext.mjs(첨부 속 개인정보 확인)."""
import sys

try:
    import pypdfium2 as pdfium
except ModuleNotFoundError:
    sys.exit(3)

out = sys.stdout.buffer
doc = pdfium.PdfDocument(sys.argv[1])
left = 2_000_000
for i in range(len(doc)):
    tp = doc[i].get_textpage()
    s = tp.get_text_range()[:left]
    out.write(s.encode("utf-8", "replace") + b"\n")
    left -= len(s)
    if left <= 0:
        break

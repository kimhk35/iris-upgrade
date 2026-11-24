# IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
# -*- coding: utf-8 -*-
"""
docpages.py — PDF 를 쪽 그림(JPEG)으로 그린다. 캔버스가 문서를 「PDF 보기 칸」이 아니라 슬라이드·종이처럼 직접 보이려고 쓴다(P18 2026-11-24).

사용:  python docpages.py <PDF> <결과 폴더>
결과:  info.json { n, sizes:[[폭,높이]…] } 를 먼저 쓰고 → p1.jpg, p2.jpg … 차례로 → 끝나면 hashes.json [쪽마다 지문]
       (앞쪽부터 바로 볼 수 있게 한 쪽씩, 다 쓴 뒤 이름을 바꿔 반쪽 그림이 보이지 않는다)
종료코드 3 = 이 파이썬에 pypdfium2·Pillow 가 없음(데몬이 다음 파이썬으로 다시 부른다)
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import pypdfium2 as pdfium
    import PIL  # noqa: F401  (to_pil 이 쓴다)
except ModuleNotFoundError as e:
    print(f"[NOMODULE] {e!r}", file=sys.stderr)
    sys.exit(3)

LANDSCAPE_W = 1600  # 슬라이드(가로가 긴 쪽)
PORTRAIT_W = 1240  # 종이(A4 150dpi 쯤)


def _put(path: str, data: bytes) -> None:
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def main() -> int:
    pdf, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    doc = pdfium.PdfDocument(pdf)
    n = len(doc)
    sizes = [[round(v, 1) for v in doc.get_page_size(i)] for i in range(n)]
    _put(os.path.join(out, "info.json"), json.dumps({"n": n, "sizes": sizes}).encode())
    hashes = []
    for i in range(n):
        w, h = sizes[i]
        page = doc[i]
        img = page.render(scale=(LANDSCAPE_W if w > h else PORTRAIT_W) / max(w, 1)).to_pil().convert("RGB")
        hashes.append(hashlib.sha1(img.tobytes()).hexdigest()[:16])
        tmp = os.path.join(out, f"p{i + 1}.tmp")
        img.save(tmp, "JPEG", quality=88)
        os.replace(tmp, os.path.join(out, f"p{i + 1}.jpg"))
        page.close()
    _put(os.path.join(out, "hashes.json"), json.dumps(hashes).encode())
    return 0


if __name__ == "__main__":
    sys.exit(main())

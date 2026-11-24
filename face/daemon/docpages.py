# IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
# -*- coding: utf-8 -*-
"""
docpages.py — PDF 를 쪽 그림(JPEG)으로 그린다. 캔버스가 문서를 「PDF 보기 칸」이 아니라 슬라이드·종이처럼 직접 보이려고 쓴다(P18 2026-11-24).

사용:  python docpages.py <PDF> <결과 폴더>
       (pN.json = 그 쪽의 글자 줄 [[왼쪽,위,오른쪽,아래(0~1), 글]] — 눌러서 고칠 곳을 고를 때)
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


def _lines(page, w: float, h: float) -> list:
    """쪽 안의 글자 줄과 자리(왼쪽 위가 0, 폭·높이 1). 못 읽으면 빈 목록 — 그림은 그대로 보인다."""
    out = []
    try:
        tp = page.get_textpage()
        rows = []  # 글꼴이 바뀌는 자리마다 나뉜 조각을 같은 줄끼리 잇는다(표의 다른 칸은 사이가 멀어 따로)
        for k in range(min(tp.count_rects(), 1500)):
            l, b, r, t = tp.get_rect(k)
            p = rows[-1] if rows else None
            if p:
                over = min(t, p[3]) - max(b, p[1])
                low = max(min(t - b, p[3] - p[1]), 0.1)
                if over > low * 0.6 and -low < l - p[2] < low * 1.2:
                    p[:] = [min(l, p[0]), min(b, p[1]), max(r, p[2]), max(t, p[3])]
                    continue
            rows.append([l, b, r, t])
        for l, b, r, t in rows:
            s = " ".join(tp.get_text_bounded(l - 0.5, b, r + 0.5, t).split())
            if s and w and h:
                out.append([round(l / w, 4), round(1 - t / h, 4), round(r / w, 4), round(1 - b / h, 4), s[:200]])
        tp.close()
    except Exception:
        pass
    return out


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
        _put(os.path.join(out, f"p{i + 1}.json"), json.dumps(_lines(page, w, h), ensure_ascii=False).encode("utf-8"))
        tmp = os.path.join(out, f"p{i + 1}.tmp")
        img.save(tmp, "JPEG", quality=88)
        os.replace(tmp, os.path.join(out, f"p{i + 1}.jpg"))
        page.close()
    _put(os.path.join(out, "hashes.json"), json.dumps(hashes).encode())
    return 0


if __name__ == "__main__":
    sys.exit(main())

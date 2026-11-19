# 캡처 원본(shots-src/*.png) → 설명서용 img/*.webp (가로 2400, 화질 88)
import os, glob
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for f in glob.glob(os.path.join(ROOT, 'shots-src', '*.png')):
    im = Image.open(f).convert('RGB')
    if im.width > 2400:
        im = im.resize((2400, round(im.height * 2400 / im.width)), Image.LANCZOS)
    out = os.path.join(ROOT, 'img', os.path.splitext(os.path.basename(f))[0] + '.webp')
    im.save(out, 'WEBP', quality=88, method=6)
    print(os.path.basename(out), os.path.getsize(out) // 1024, 'KB')

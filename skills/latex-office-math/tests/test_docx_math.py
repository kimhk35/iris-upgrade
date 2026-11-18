"""docx_math 실제 시험 — 최소 docx 를 임시 폴더에 만들어 바꾼 뒤, 워드(COM)로 열어 수식 개수를 센다(워드 설치 PC 만).
python tests\\test_docx_math.py"""
import os, re, shutil, subprocess, sys, tempfile, zipfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from docx_math import convert  # noqa: E402

ok = bad = 0
def check(c, n):
    global ok, bad
    ok, bad = (ok + 1, bad) if c else (ok, bad + 1)
    print(("PASS " if c else "FAIL ") + n)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
def para(*runs, center=False):
    ppr = '<w:pPr><w:jc w:val="center"/></w:pPr>' if center else ""
    return f"<w:p>{ppr}" + "".join(f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{t}</w:t></w:r>' for t in runs) + "</w:p>"
body = (para("근의 공식은 $x = \\frac{-b \\pm ", "\\sqrt{b^2-4ac}}{2a}$ 입니다.")      # 수식이 두 덩어리에 걸침
        + para("$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$")
        + para("가격은 $5 이고 할인가는 $3 입니다.")
        # 필드(쪽 번호)가 섞인 문단은 건드리지 않음 — 빈 <w:drawing/> 은 워드가 손상으로 보므로 온전한 필드를 쓴다
        + '<w:p><w:r><w:t xml:space="preserve">쪽 번호 옆 $y=2$ </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')
doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}"><w:body>{body}<w:sectPr/></w:body></w:document>'
tmp = tempfile.mkdtemp(prefix="docxmath-")
src = os.path.join(tmp, "시험.docx")
with zipfile.ZipFile(src, "w") as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    z.writestr("word/document.xml", doc)
before = open(src, "rb").read()
r = convert(src)
check(r["converted"] == 2 and not r["failed"], f"수식 2개 바꿈 (바꿈 {r['converted']}, 실패 {r['failed']})")
check(r["missed"] == ["$y=2$"], f"필드 섞인 문단은 건드리지 않고 알림 ({r['missed']})")
check(open(src, "rb").read() == before, "원본은 그대로")
xml = zipfile.ZipFile(r["out"]).read("word/document.xml").decode("utf-8")
check(xml.count("<m:oMath>") + xml.count("<m:oMath ") == 2 and xml.count("<m:oMathPara") == 1, "OMML 수식 2개 · 그중 가운데 수식 1개(겹싸지 않음)")
check("가격은 $5 이고 할인가는 $3 입니다." in xml and "\\frac" not in xml, "돈 표기는 그대로 · LaTeX 글자는 남지 않음")
check(xml.count("<w:b/>") >= 3, "글자 모양(굵게)은 이어짐")
# 워드로 열어 수식 개수 세기
res = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(os.path.dirname(os.path.abspath(__file__)), "word_count_math.ps1"), "-Path", r["out"]], capture_output=True)
txt = res.stdout.decode("ascii", "replace").strip()
check(txt == "2", f"워드가 열고 수식 2개로 읽음 ({txt or res.stderr.decode('utf-8', 'replace')[:200]!r})")
shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{ok} PASS / {bad} FAIL")
sys.exit(1 if bad else 0)

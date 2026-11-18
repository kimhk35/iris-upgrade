"""표절 점검 시험 — 지어낸 자료·원고를 임시 폴더에 만들어 돌린다. python -I tests\\test_plagiarism.py"""
import json, os, shutil, sys, tempfile, zipfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from plagiarism import run, cites_in, normalize  # noqa: E402
from extract import read_text  # noqa: E402

ok = bad = 0
def check(c, n):
    global ok, bad
    ok, bad = (ok + 1, bad) if c else (ok, bad + 1)
    print(("PASS " if c else "FAIL ") + n)

KO = ("수학 불안은 학습자가 수학 문제를 풀거나 수학 수업에 참여할 때 느끼는 긴장과 두려움의 감정으로 정의된다. "
      "선행 연구에 따르면 수학 불안이 높은 학생은 작업 기억의 용량이 줄어들어 복잡한 문제 해결에서 낮은 성취를 보인다. "
      "따라서 교사는 실수를 허용하는 수업 분위기를 만들어 학생의 정서적 부담을 낮출 필요가 있다.")
EN = ("Productive struggle refers to the effortful engagement of students with mathematical tasks that are within reach "
      "but not immediately solvable, and it has been linked to deeper conceptual understanding in classroom studies.")
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
def docx(path, paras):
    body = "".join(f'<w:p><w:r><w:t xml:space="preserve">{p}</w:t></w:r></w:p>' for p in paras)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')

tmp = tempfile.mkdtemp(prefix="plag-")
refs = os.path.join(tmp, "자료"); os.makedirs(refs)
open(os.path.join(refs, "김민수2021.txt"), "w", encoding="utf-8").write(KO + "\n\n참고문헌\n홍길동 (2010). 옛 논문.\n")
docx(os.path.join(refs, "smith2019.docx"), [EN, "Other unrelated text about teacher noticing and curriculum design in schools."])
open(os.path.join(refs, "빈파일.txt"), "w", encoding="utf-8").write("짧음")

target = os.path.join(tmp, "원고.docx")
docx(target, [
    "서론. 이 연구는 중학생의 수학 정서를 다룬다.",
    # ① 출처 없이 그대로 옮김
    "수학 불안이 높은 학생은 작업 기억의 용량이 줄어들어 복잡한 문제 해결에서 낮은 성취를 보인다.",
    # ② 따옴표 + 출처 = 정상 인용
    "김민수(2021)는 수학 불안을 “학습자가 수학 문제를 풀거나 수학 수업에 참여할 때 느끼는 긴장과 두려움의 감정”이라고 정의하였다.",
    # ③ 출처는 있으나 원문 그대로
    "Productive struggle refers to the effortful engagement of students with mathematical tasks that are within reach (Smith, 2019).",
    # 내 글 + 목록에 없는 인용
    "본 연구자는 이러한 결과가 수업 설계에서 정서 지원 활동을 우선 배치해야 함을 시사한다고 본다(Park, 2020).",
    "학생들의 수학 학습 동기와 자기 효능감은 장기적인 진로 선택에도 영향을 주는 핵심 요인으로 여러 학교 현장에서 관찰된다.",
    "참고문헌",
    "김민수 (2021). 수학 불안의 정의와 측정. 수학교육, 10(2), 1-20.",
    "Smith, J. (2019). Productive struggle in classrooms. Journal of Math, 3, 4-9.",
    "Lee, K. (2018). Unused reference entry. Journal, 1, 1-2.",
])

check("작업 기억" in read_text(target) and "Productive" in read_text(os.path.join(refs, "smith2019.docx")), "docx 글자 읽기")
check(normalize("A b, 가!")[0] == "ab가", "글자 정리(빈칸·부호 제거, 소문자)")
check(set(cites_in("김민수(2021)는 … (Smith, 2019; Lee et al., 2018)")) == {("김민수", "2021"), ("Smith", "2019"), ("Lee", "2018")}, "본문 인용 찾기")

s, rep = run(target, refs)
kinds = sorted(i["kind"] for i in s["issues"])
check(s["refs_compared"] == 2 and any("빈파일" in x for x in s["skipped"]), f"자료 2개 대조 · 빈 파일은 건너뜀 ({s['refs_compared']}, {s['skipped']})")
check(kinds == ["출처 표시 없음", "출처는 있으나 원문 그대로"], f"문제 2곳: 출처 없음 1 · 원문 그대로 1 ({kinds})")
check(s["no_citation"] == 1 and s["cited_but_verbatim"] == 1, "개수 요약")
check(s["total_pct"] > s["risk_pct"] > 0, f"정상 인용은 위험 비율에서 뺌 (전체 {s['total_pct']} > 위험 {s['risk_pct']})")
check({r["name"] for r in s["by_ref"]} == {"김민수2021.txt", "smith2019.docx"}, "자료별 겹침")
rl = s["reference_list"]
check(rl["missing_in_list"] == ["Park (2020)"], f"목록에 없는 인용 ({rl['missing_in_list']})")
check(len(rl["unused_in_text"]) == 1 and "Lee" in rl["unused_in_text"][0], f"본문에서 안 쓴 목록 ({rl['unused_in_text']})")
check("참고문헌" not in "".join(i["mine"] for i in s["issues"]), "원고의 참고문헌 목록은 겹침 계산에서 뺌")
check(rep and "<mark class=\"m nocite\"" in rep and "<mark class=\"m ok\"" in rep and "prefers-color-scheme" in rep, "보고서: 형광펜(문제·정상) · 어두운 화면")

# 짧은 흔한 표현은 겹침으로 안 셈
open(os.path.join(tmp, "짧은.txt"), "w", encoding="utf-8").write("선행 연구에 따르면 결과가 다르다. 완전히 새로운 내 문장이 길게 이어지고 아무것도 베끼지 않았다.")
s2, _ = run(os.path.join(tmp, "짧은.txt"), refs)
check(s2["total_pct"] == 0, f"짧은 흔한 표현(30글자 미만)은 안 셈 ({s2['total_pct']})")

# 웹 대조: 고르기 → 결과 합치기
p, _ = run(target, refs, pick=3)
cands = p["web_candidates"]
check(cands and all("작업 기억" not in c["sentence"] and "(Park" not in c["sentence"] for c in cands), "웹 후보: 이미 겹친 문장·인용 문장은 빼고 고름")
check(all(c["query"].startswith('"') for c in cands), "웹 후보: 따옴표 검색어")
wf = os.path.join(tmp, "web.json")
json.dump([{"id": cands[0]["id"], "verdict": "similar", "url": "https://example.org/a", "title": "예시 글"}], open(wf, "w", encoding="utf-8"), ensure_ascii=False)
s3, rep3 = run(target, refs, web_file=wf)
check(s3["web_hits"] == 1 and 'class="w"' in rep3 and "https://example.org/a" in rep3, "웹 결과가 보고서에 합쳐짐")

# hwpx 읽기(수식 견본이 있으면)
hx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "확인용", "수식견본", "견본-한글수식.hwpx")
if os.path.exists(hx):
    t = read_text(hx)
    check("근의 공식" in t and "over" not in t, "hwpx 글자 읽기(수식 스크립트는 뺌)")

shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{ok} PASS / {bad} FAIL")
sys.exit(1 if bad else 0)

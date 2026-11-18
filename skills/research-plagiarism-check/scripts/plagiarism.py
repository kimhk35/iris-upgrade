"""연구 문서 표절·인용 점검 (P18 IRIS 고도화, 2026-11-17).

1) 내 자료 대조 — 참고 자료 폴더의 문서들과 글자 그대로 겹치는 구간을 찾는다(빈칸·문장부호를 뺀 글자 8개 묶음을 이어 붙여,
   겹침이 30글자 이상 이어질 때만 셈). 한국어·영어 모두.
2) 인용 점검 — 겹친 구간마다 출처 표시((저자, 연도) · 저자(연도) · [번호])와 따옴표가 있는지 본다.
   본문 인용 ↔ 참고문헌 목록이 서로 맞는지도 본다(목록에 없는 인용 · 본문에서 안 쓴 목록).
3) 웹 대조 — 인터넷 검색은 이 스크립트가 하지 않는다. --pick-web 으로 검색할 특이 문장을 골라 주면 AI 가 자기 웹 검색으로
   찾아보고, 결과를 JSON 으로 적어 --web 으로 넘기면 보고서에 합친다(추가 비용 없음).

결과: 형광펜 HTML 보고서(--out) + 요약 JSON(표준 출력). 원본 문서는 읽기만 한다.

쓰기:
  python plagiarism.py 원고.docx --refs 참고자료폴더 --out 보고서.html
  python plagiarism.py 원고.docx --refs 참고자료폴더 --pick-web 8          # 웹 검색할 문장 목록(JSON)
  python plagiarism.py 원고.docx --refs 참고자료폴더 --web 웹결과.json --out 보고서.html
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import SUPPORTED, read_text  # noqa: E402

SHINGLE = 8        # 비교 단위(정리한 글자 수)
MIN_RUN = 30       # 이만큼(정리한 글자) 이어져야 '겹침'으로 센다 — 흔한 짧은 표현은 빼기 위해
GAP = 4            # 한두 글자 바뀐 틈은 한 구간으로 이어 본다
LONG_VERBATIM = 60 # 출처가 있어도 이보다 길게 그대로 옮기면 따옴표·바꿔 쓰기를 권한다

REF_HEAD = re.compile(r"^\s*(?:#+\s*)?(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX\d]+[.)]?\s*)?(참고\s*문헌|인용\s*문헌|참고\s*자료|References?|Bibliography|Works\s+Cited)\s*:?\s*$", re.I | re.M)
YEAR = r"(?:19|20)\d{2}[a-z]?"
CITE_PAREN = re.compile(rf"\(([^()]*?{YEAR}[^()]*?)\)")
CITE_NAME_YEAR = re.compile(rf"([A-Z][A-Za-z'\-]+|[가-힣]{{2,4}})(?:\s*(?:et al\.|외|등|and [A-Z][A-Za-z'\-]+|& [A-Z][A-Za-z'\-]+))?\s*\(({YEAR})\)")
CITE_NUM = re.compile(r"\[(\d+(?:\s*[-–,]\s*\d+)*)\]")
QUOTES = re.compile(r"“[^”]{2,}”|\"[^\"\n]{2,}\"|「[^」]{2,}」|『[^』]{2,}』|‘[^’]{2,}’")


# ── 글자 정리 ─────────────────────────────────────────────
def normalize(text: str) -> tuple[str, list[int]]:
    """글자·숫자만 남기고 소문자로 — 원래 위치표를 함께 돌려준다"""
    chars, idx = [], []
    for i, c in enumerate(text):
        if c.isalnum():
            chars.append(c.lower()); idx.append(i)
    return "".join(chars), idx


def split_body(text: str) -> tuple[str, str]:
    """본문 / 참고문헌 목록(맨 마지막 '참고문헌' 제목 뒤)"""
    heads = list(REF_HEAD.finditer(text))
    if not heads:
        return text, ""
    h = heads[-1]
    return text[:h.start()], text[h.end():]


def sentences(text: str) -> list[tuple[int, int]]:
    out, start = [], 0
    for m in re.finditer(r"(?<=[.!?。])[\"'”’)\]]*\s+|\n+", text):
        if text[start:m.start()].strip():
            out.append((start, m.end()))
        start = m.end()
    if text[start:].strip():
        out.append((start, len(text)))
    return out


# ── 1) 내 자료 대조 ──────────────────────────────────────
class Index:
    def __init__(self):
        self.refs: list[dict] = []
        self.table: dict[int, tuple[int, int]] = {}

    def add(self, name: str, text: str):
        body, _ = split_body(text)  # 참고 자료의 참고문헌 목록끼리 겹치는 것은 표절이 아니다
        norm, idx = normalize(body)
        rid = len(self.refs)
        self.refs.append({"name": name, "text": body, "norm": norm, "idx": idx})
        for i in range(0, max(0, len(norm) - SHINGLE + 1)):
            self.table.setdefault(hash(norm[i:i + SHINGLE]), (rid, i))

    def match(self, norm: str) -> list[dict]:
        """대상 정리글에서 겹친 구간들 [{s,e(정리 위치), ref, rpos}]"""
        cover: list[int | None] = [None] * len(norm)
        first: dict[int, int] = {}
        for i in range(0, max(0, len(norm) - SHINGLE + 1)):
            hit = self.table.get(hash(norm[i:i + SHINGLE]))
            if hit is None:
                continue
            rid, rpos = hit
            if self.refs[rid]["norm"][rpos:rpos + SHINGLE] != norm[i:i + SHINGLE]:
                continue  # 해시 충돌
            for j in range(i, i + SHINGLE):
                if cover[j] is None:
                    cover[j] = rid
                    first.setdefault(j, rpos + (j - i))
        runs, j = [], 0
        while j < len(norm):
            if cover[j] is None:
                j += 1; continue
            rid, s = cover[j], j
            while j < len(norm):
                if cover[j] == rid:
                    j += 1; continue
                k = j
                while k < len(norm) and k - j <= GAP and cover[k] is None:
                    k += 1
                if k < len(norm) and k - j <= GAP and cover[k] == rid:
                    j = k; continue
                break
            runs.append({"s": s, "e": j, "ref": rid, "rpos": first.get(s, 0)})
        return [r for r in runs if r["e"] - r["s"] >= MIN_RUN]


# ── 2) 인용 점검 ──────────────────────────────────────────
def cites_in(text: str) -> list[tuple[str, str]]:
    """본문 속 (저자, 연도) 인용 목록"""
    out = []
    for m in CITE_PAREN.finditer(text):
        for part in re.split(r";", m.group(1)):
            y = re.search(YEAR, part)
            if not y:
                continue
            who = re.sub(r"\bet al\.?|\b외\b|\b등\b|[,&]|\band\b", " ", part[:y.start()]).split()
            if who:
                out.append((who[0], y.group(0)[:4]))
    for m in CITE_NAME_YEAR.finditer(text):
        out.append((m.group(1), m.group(2)[:4]))
    return out


def ref_entries(refs_text: str) -> list[dict]:
    out = []
    for line in refs_text.splitlines():
        t = line.strip()
        if len(t) < 8:
            continue
        num = re.match(r"^\[?(\d+)[\].)]\s*", t)
        body = t[num.end():] if num else t
        y = re.search(YEAR, body)
        first = re.split(r"[,.(\s]", body.strip(), maxsplit=1)[0]
        out.append({"line": t, "num": int(num.group(1)) if num else None, "author": first, "year": y.group(0)[:4] if y else ""})
    return out


def _same_author(a: str, b: str) -> bool:
    a, b = a.lower(), b.lower()
    return bool(a and b) and (a == b or a.startswith(b) or b.startswith(a))


def check_reference_list(body: str, refs_text: str) -> dict:
    entries = ref_entries(refs_text)
    cited = cites_in(body)
    nums = set()
    for m in CITE_NUM.finditer(body):
        for part in re.split(r",", m.group(1)):
            ab = re.split(r"\s*[-–]\s*", part.strip())
            if len(ab) == 2 and ab[0].isdigit() and ab[1].isdigit() and int(ab[1]) - int(ab[0]) < 50:
                nums.update(range(int(ab[0]), int(ab[1]) + 1))
            elif ab[0].isdigit():
                nums.add(int(ab[0]))
    missing, seen = [], set()
    for who, yr in cited:
        key = (who.lower(), yr)
        if key in seen:
            continue
        seen.add(key)
        if not any(_same_author(who, e["author"]) and e["year"] == yr for e in entries):
            missing.append(f"{who} ({yr})")
    unused = []
    for e in entries:
        if e["num"] is not None:
            if e["num"] not in nums:
                unused.append(e["line"])
        elif not any(_same_author(w, e["author"]) and y == e["year"] for w, y in cited):
            unused.append(e["line"])
    num_missing = sorted(n for n in nums if not any(e["num"] == n for e in entries)) if entries else sorted(nums)
    return {"has_list": bool(refs_text.strip()), "entries": len(entries), "cited": len(seen) + len(nums),
            "missing_in_list": missing + [f"[{n}]" for n in num_missing], "unused_in_text": unused}


def classify(text: str, s: int, e: int, sents: list[tuple[int, int]], quotes: list[tuple[int, int]]) -> tuple[str, bool]:
    """겹친 원문 구간 → (판정, 따옴표 안인가)"""
    k = [i for i, (a, b) in enumerate(sents) if a < e and b > s]
    lo = sents[k[0]][0] if k else s
    hi = sents[k[-1]][1] if k else e
    ctx = text[lo:hi]
    # 문장 끝 바로 뒤에 붙인 출처 '… 이다. (Smith, 2019)' 까지만 인정 — 다음 문장의 다른 인용을 끌어오지 않는다
    tail = re.match(rf"\s*(\([^()]*{YEAR}[^()]*\)|\[\d[\d,\s\-–]*\])", text[hi:hi + 60])
    has_cite = bool(CITE_PAREN.search(ctx) or CITE_NAME_YEAR.search(ctx) or CITE_NUM.search(ctx) or tail)
    inside = sum(max(0, min(e, qb) - max(s, qa)) for qa, qb in quotes) >= 0.6 * (e - s)
    if has_cite and inside:
        return "ok", True
    if has_cite:
        return "cite_noquote", False
    return "nocite", inside


LABEL = {"ok": "정상 인용(따옴표+출처)", "cite_noquote": "출처는 있으나 원문 그대로", "nocite": "출처 표시 없음"}
ADVICE = {"ok": "그대로 두어도 됩니다.",
          "cite_noquote": "따옴표로 묶어 직접 인용으로 하거나, 자기 말로 바꿔 쓰세요(출처는 유지).",
          "nocite": "출처를 밝히세요 — 직접 인용이면 따옴표 + (저자, 연도), 아니면 자기 말로 바꿔 쓰고 출처를 다세요."}


# ── 3) 웹 대조용 문장 고르기 ─────────────────────────────
def pick_web(text: str, covered: list[tuple[int, int]], n: int) -> list[dict]:
    cands = []
    for a, b in sentences(text):
        t = text[a:b].strip()
        a = a + (len(text[a:b]) - len(text[a:b].lstrip())); b = a + len(t)  # 앞뒤 빈칸·줄바꿈은 형광펜에서 뺀다
        if len(t) < 40 or CITE_PAREN.search(t) or CITE_NUM.search(t) or QUOTES.search(t):
            continue
        if any(x < b and y > a for x, y in covered):
            continue
        letters = sum(ch.isalpha() for ch in t)
        if letters < 25:
            continue
        cands.append((a, b, t))
    if len(cands) > n:  # 문서 전체에서 고르게
        step = len(cands) / n
        cands = [max(cands[int(i * step):int((i + 1) * step)], key=lambda c: len(c[2])) for i in range(n)]
    out = []
    for i, (a, b, t) in enumerate(cands):
        words = t.split()
        q = " ".join(words[:12]) if len(words) >= 8 else t[:60]
        out.append({"id": f"w{i + 1}", "start": a, "end": b, "sentence": t, "query": f"\"{q.strip(' .,')}\""})
    return out


# ── 보고서 ───────────────────────────────────────────────
COLORS = ["#f4b400", "#ef6c6c", "#5aa9e6", "#7bc67b", "#c58af9", "#ff9f5a", "#4dd0c8", "#e57fbf"]


def build_report(name: str, text: str, body_len: int, spans: list[dict], refs: list[dict], reflist: dict, web: list[dict], stats: dict) -> str:
    esc = lambda s: html.escape(s, quote=True)
    marks = sorted([("m", sp["start"], sp["end"], sp) for sp in spans] + [("w", w["start"], w["end"], w) for w in web if w.get("verdict") in ("same", "similar")], key=lambda m: m[1])
    parts, pos = [], 0
    for kind, a, b, d in marks:
        if a < pos:
            continue
        parts.append(esc(text[pos:a]))
        if kind == "m":
            c = COLORS[d["ref"] % len(COLORS)]
            parts.append(f'<mark class="m {d["kind"]}" style="--c:{c}" id="s{d["n"]}" title="{esc(refs[d["ref"]]["name"])} · {LABEL[d["kind"]]}">'
                         f'{esc(text[a:b])}<sup>{d["n"]}</sup></mark>')
        else:
            parts.append(f'<mark class="w" title="웹: {esc(d.get("title") or d.get("url", ""))}">{esc(text[a:b])}<sup>웹</sup></mark>')
        pos = b
    parts.append(esc(text[pos:]))
    src_rows = "".join(f'<tr><td><i style="background:{COLORS[i % len(COLORS)]}"></i>{esc(r["name"])}</td><td>{r["pct"]:.1f}%</td><td>{r["count"]}</td></tr>'
                       for i, r in enumerate(stats["by_ref"]) if r["count"])
    items = "".join(
        f'<li class="{sp["kind"]}"><a href="#s{sp["n"]}">#{sp["n"]}</a> <b>{LABEL[sp["kind"]]}</b> · {esc(refs[sp["ref"]]["name"])} · {sp["chars"]}글자'
        f'<div class="q">내 글: {esc(sp["mine"])}</div><div class="q r">자료: {esc(sp["theirs"])}</div><div class="adv">→ {ADVICE[sp["kind"]]}</div></li>'
        for sp in spans if sp["kind"] != "ok")
    web_items = "".join(
        f'<li class="{"nocite" if w.get("verdict") == "same" else "" if w.get("verdict") == "similar" else "none"}">'
        f'<b>{ {"same": "같은 문장 있음", "similar": "비슷한 문장 있음", "none": "찾지 못함"}.get(w.get("verdict"), "확인 안 됨") }</b> · {esc(w["sentence"][:120])}'
        + (f'<div class="q r"><a href="{esc(w["url"])}" target="_blank" rel="noopener">{esc(w.get("title") or w["url"])}</a>{" — " + esc(w["note"]) if w.get("note") else ""}</div>' if w.get("url") else "")
        + "</li>" for w in web)
    rl = reflist
    rl_html = ("<p>참고문헌 목록을 찾지 못했습니다(‘참고문헌’ 또는 ‘References’ 제목 줄). 출처를 밝힌 글이면 목록을 붙이세요.</p>" if not rl["has_list"] else
               f'<p>목록 {rl["entries"]}개 · 본문 인용 {rl["cited"]}개</p>'
               + (f'<p class="bad">목록에 없는 본문 인용: {esc(", ".join(rl["missing_in_list"]))}</p>' if rl["missing_in_list"] else '<p class="good">본문 인용은 모두 목록에 있습니다.</p>')
               + (f'<p class="warn">본문에서 쓰지 않은 목록:</p><ul>{"".join("<li>" + esc(u) + "</li>" for u in rl["unused_in_text"])}</ul>' if rl["unused_in_text"] else ""))
    level = "높음" if stats["risk_pct"] >= 15 or stats["nocite"] >= 3 else "보통" if stats["risk_pct"] >= 5 or stats["nocite"] else "낮음"
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>표절 점검 보고서</title><style>
:root{{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1f;--mute:#6b6b70;--line:#e2e0da;--bad:#c0392b;--warn:#b7791f;--good:#1f8a4c}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#17181b;--card:#212226;--ink:#ececee;--mute:#a0a0a8;--line:#33343a;--bad:#ff7b6b;--warn:#f0b35a;--good:#5bc98a}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 "Malgun Gothic",system-ui,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:28px 16px 64px}}h1{{font-size:24px;margin:0 0 4px}}.sub{{color:var(--mute);margin:0 0 20px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}}h2{{font-size:18px;margin:0 0 10px}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}}.kpi b{{display:block;font-size:26px}}.kpi span{{color:var(--mute);font-size:14px}}
.risk-높음 b{{color:var(--bad)}}.risk-보통 b{{color:var(--warn)}}.risk-낮음 b{{color:var(--good)}}
table{{border-collapse:collapse;width:100%}}td{{padding:6px 8px;border-bottom:1px solid var(--line)}}td i{{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:8px;vertical-align:-1px}}
.doc{{white-space:pre-wrap;word-break:break-word}}mark.m{{background:color-mix(in srgb,var(--c) 32%,transparent);color:inherit;border-bottom:2px solid var(--c);border-radius:3px}}
mark.m.ok{{background:color-mix(in srgb,var(--c) 12%,transparent);border-bottom-style:dotted}}mark.w{{background:transparent;color:inherit;border-bottom:2px dashed var(--bad)}}
sup{{font-size:11px;color:var(--mute);margin-left:2px}}ul.iss{{list-style:none;padding:0;margin:0}}ul.iss li{{border-left:4px solid var(--warn);padding:8px 12px;margin:10px 0;background:color-mix(in srgb,var(--warn) 7%,transparent);border-radius:0 8px 8px 0}}
ul.iss li.nocite{{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 7%,transparent)}}ul.iss li.none{{border-color:var(--line);background:transparent}}.q{{font-size:14px;color:var(--mute);margin-top:4px}}.q.r{{font-style:italic}}.adv{{font-size:14px;margin-top:4px}}
.bad{{color:var(--bad)}}.warn{{color:var(--warn)}}.good{{color:var(--good)}}.note{{font-size:14px;color:var(--mute)}}a{{color:inherit}}
</style></head><body><main>
<h1>표절·인용 점검 보고서</h1><p class="sub">{esc(name)} · {datetime.now().strftime("%Y-%m-%d %H:%M")} · 참고 자료 {len(refs)}개 대조{" · 웹 검색 " + str(len(web)) + "문장" if web else ""}</p>
<section class="card"><div class="kpis">
<div class="kpi risk-{level}"><b>{level}</b><span>위험도</span></div>
<div class="kpi"><b>{stats["total_pct"]:.1f}%</b><span>자료와 겹친 비율(전체)</span></div>
<div class="kpi"><b>{stats["risk_pct"]:.1f}%</b><span>정상 인용 뺀 비율</span></div>
<div class="kpi"><b>{stats["nocite"]}</b><span>출처 표시 없는 겹침</span></div>
<div class="kpi"><b>{stats["noquote"]}</b><span>출처만 있고 원문 그대로</span></div>
<div class="kpi"><b>{stats["web_hits"]}</b><span>웹에서 같은·비슷한 문장</span></div>
</div><p class="note">겹침은 빈칸·문장부호를 뺀 글자 {MIN_RUN}개 이상이 그대로 이어질 때만 셉니다. 바꿔 쓴 글(의미만 같은 글)은 잡지 못하므로, 이 수치는 ‘최소한’입니다. 참고문헌 목록은 계산에서 뺍니다.</p></section>
{f'<section class="card"><h2>자료별 겹침</h2><table>{src_rows}</table></section>' if src_rows else ''}
<section class="card"><h2>고쳐야 할 곳</h2>{f'<ul class="iss">{items}</ul>' if items else '<p class="good">출처 없이 겹친 곳이 없습니다.</p>'}</section>
<section class="card"><h2>참고문헌 목록 점검</h2>{rl_html}</section>
{f'<section class="card"><h2>웹 대조</h2><ul class="iss">{web_items}</ul><p class="note">AI 가 특이한 문장을 골라 웹에서 찾아본 결과입니다. 검색에 안 잡힌다고 원문이 없다는 뜻은 아닙니다.</p></section>' if web else ''}
<section class="card"><h2>원고 전체(형광펜)</h2><p class="note">색 = 자료별 · 점선 = 정상 인용 · 빨간 점선 = 웹에서 찾은 문장 · 위첨자 번호 = 위 목록 번호</p><div class="doc">{"".join(parts)}</div></section>
</main></body></html>"""


# ── 실행 ─────────────────────────────────────────────────
def run(target: str, refs_dir: str | None, web_file: str | None = None, pick: int = 0) -> tuple[dict, str | None]:
    text = read_text(target).replace("\r\n", "\n").replace("\r", "\n")
    body, refs_text = split_body(text)
    index, skipped = Index(), []
    if refs_dir:
        tgt = os.path.normcase(os.path.abspath(target))
        for root, _, files in os.walk(refs_dir):
            for f in sorted(files):
                p = os.path.join(root, f)
                if not f.lower().endswith(SUPPORTED) or f.startswith("~$") or os.path.normcase(os.path.abspath(p)) == tgt:
                    continue
                try:
                    t = read_text(p)
                    if len(t.strip()) < 50:
                        skipped.append(f"{f}: 글자가 거의 없음(스캔 PDF?)"); continue
                    index.add(os.path.relpath(p, refs_dir), t)
                except Exception as e:  # noqa: BLE001
                    skipped.append(f"{f}: {e}")
    norm, idx = normalize(body)
    runs = index.match(norm) if index.refs else []
    sents, quotes = sentences(body), [(m.start(), m.end()) for m in QUOTES.finditer(body)]
    spans = []
    for n, r in enumerate(runs, 1):
        s, e = idx[r["s"]], idx[r["e"] - 1] + 1
        kind, _ = classify(body, s, e, sents, quotes)
        ref = index.refs[r["ref"]]
        rs = ref["idx"][min(r["rpos"], len(ref["idx"]) - 1)]
        re_ = ref["idx"][min(r["rpos"] + (r["e"] - r["s"]) - 1, len(ref["idx"]) - 1)] + 1
        cut = lambda t: t if len(t) <= 220 else t[:200] + " … " + t[-15:]
        spans.append({"n": n, "start": s, "end": e, "ref": r["ref"], "kind": kind, "chars": r["e"] - r["s"],
                      "mine": cut(re.sub(r"\s+", " ", body[s:e])), "theirs": cut(re.sub(r"\s+", " ", ref["text"][rs:re_]))})
    total = max(1, len(norm))
    by_ref = [{"name": r["name"], "count": sum(1 for sp in spans if sp["ref"] == i),
               "pct": 100 * sum(sp["chars"] for sp in spans if sp["ref"] == i) / total} for i, r in enumerate(index.refs)]
    web = []
    if web_file:
        picked = {w["id"]: w for w in pick_web(body, [(sp["start"], sp["end"]) for sp in spans], 50)}
        for w in json.load(open(web_file, encoding="utf-8")):
            base = picked.get(w.get("id")) or next((p for p in picked.values() if p["sentence"] == w.get("sentence")), None)
            if base is None and w.get("sentence") and w["sentence"] in body:
                a = body.index(w["sentence"]); base = {"start": a, "end": a + len(w["sentence"]), "sentence": w["sentence"]}
            if base:
                web.append({**base, **{k: w[k] for k in ("url", "title", "verdict", "note") if k in w}})
    stats = {"total_pct": 100 * sum(sp["chars"] for sp in spans) / total,
             "risk_pct": 100 * sum(sp["chars"] for sp in spans if sp["kind"] != "ok") / total,
             "nocite": sum(sp["kind"] == "nocite" for sp in spans), "noquote": sum(sp["kind"] == "cite_noquote" for sp in spans),
             "web_hits": sum(w.get("verdict") in ("same", "similar") for w in web), "by_ref": by_ref}
    reflist = check_reference_list(body, refs_text)
    summary = {"target": os.path.abspath(target), "refs_compared": len(index.refs), "skipped": skipped,
               "total_pct": round(stats["total_pct"], 1), "risk_pct": round(stats["risk_pct"], 1),
               "no_citation": stats["nocite"], "cited_but_verbatim": stats["noquote"], "web_hits": stats["web_hits"],
               "by_ref": [{"name": r["name"], "pct": round(r["pct"], 1), "count": r["count"]} for r in by_ref if r["count"]],
               "issues": [{"n": sp["n"], "kind": LABEL[sp["kind"]], "ref": index.refs[sp["ref"]]["name"], "mine": sp["mine"]} for sp in spans if sp["kind"] != "ok"],
               "reference_list": reflist}
    if pick:
        summary = {"web_candidates": [{k: w[k] for k in ("id", "sentence", "query")} for w in pick_web(body, [(sp["start"], sp["end"]) for sp in spans], pick)]}
        return summary, None
    return summary, build_report(os.path.basename(target), body, len(norm), spans, index.refs, reflist, web, stats)


def main(argv=None):
    ap = argparse.ArgumentParser(description="연구 문서 표절·인용 점검")
    ap.add_argument("target"); ap.add_argument("--refs"); ap.add_argument("--web"); ap.add_argument("--out")
    ap.add_argument("--pick-web", type=int, default=0)
    a = ap.parse_args(argv)
    summary, report = run(a.target, a.refs, a.web, a.pick_web)
    if report is not None:
        out = a.out or os.path.splitext(os.path.abspath(a.target))[0] + "-표절점검.html"
        if os.path.normcase(os.path.abspath(out)) == os.path.normcase(os.path.abspath(a.target)):
            raise SystemExit("보고서 경로가 원고와 같습니다")
        with open(out, "w", encoding="utf-8") as f:
            f.write(report)
        summary["report"] = out
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 보내기 전 개인정보 확인(P18 2026-11-24 사용자 선택 4번). 이 화면 안에서만 글자 모양으로 찾는다(바깥 전송·AI 호출 0).
   찾는 것 = 휴대전화 · 유선전화 · 주민(외국인)번호 · 학번+이름 · 학년 반 번호(이름) · 이메일. 막지 않는다 — 「가려서 보내기 / 그대로 보내기 / 취소」.
   한계(설정에 적음): 첨부한 파일 속과 터미널 보기에서 직접 친 글은 보지 않는다. 이름만 적힌 글은 알 수 없다. */
(() => {
  const SUR = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용';
  const NAME = `(?:[${SUR}][가-힣]{1,2}|(?:남궁|황보|제갈|선우|독고|사공)[가-힣]{1,2})`;
  // 이름 뒤 = 글 끝·빈칸·기호, 또는 조사·호칭 다음에 글자가 아닌 것(「이차함수」 같은 낱말을 이름으로 보지 않게)
  const TAIL = '(?=$|[^가-힣]|(?:학생|군|양|이가|이는|이의|이를|이|가|은|는|의|을|를|에게|와|과|도)(?![가-힣]))';
  // 성씨로 시작하지만 이름이 아닌 흔한 말(「10101 정답은」 같은 글)
  const STOP = new Set('장난감 문제 문제집 문항 정답 정답률 정리 정수 정도 정보 정의 조건 조사 조각 유리수 유형 유의 방정식 방법 방향 전체 전화 이상 이하 이내 이유 이차식 이름 이후 이전 기준 기타 기록 기간 안내 안내문 주소 주간 주제 성적 성명 성취 성별 남자 남녀 여자 신청 신규 고사 고등 고정 배점 배정 강의 강당 임시 한글 한국 한번 오답 오류 오전 오후 서술형 서식 서류 권장 구분 구간 구역 우수 우편 나머지 지도 지역 지필 진행 진도 채점 원점수 원본 공통 공지 현재 현황 함수 변경 변수 추가 추천 도형 도움 도서 석차 선택 선생님 설명 설문 연습 연수 위치 표시 명단 명렬 반복 반별 인원 인쇄 제목 제출 모둠 모두 국어 국가 용도 은행 편집'.split(' '));
  const isName = (n) => !STOP.has(n) && !STOP.has(n.replace(/[이가은는의을를과와도]$/, ''));
  const validYmd = (s) => { const m = Number(s.slice(2, 4)), d = Number(s.slice(4, 6)); return m >= 1 && m <= 12 && d >= 1 && d <= 31; };
  const RULES = [
    { type: 'rrn', label: '주민등록번호', re: /(?<!\d)(\d{6})[-\s]?([1-8]\d{6})(?!\d)/g, ok: (m) => validYmd(m[1]), mask: () => '******-*******' },
    { type: 'phone', label: '휴대전화', re: /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, mask: () => '010-****-****' },
    { type: 'tel', label: '전화번호', re: /(?<!\d)0(?:2|[3-6]\d)[-.)]\s?\d{3,4}[-.]\d{4}(?!\d)/g, mask: () => '0**-***-****' },
    { type: 'student', label: '학번과 이름', re: new RegExp(`(?<![\\d.])([1-6])(\\d{2})(\\d{2})(?!\\d)[\\s,/\\t·]{0,3}(${NAME})${TAIL}`, 'g'), ok: (m) => { const c = Number(m[2]), n = Number(m[3]); return c >= 1 && c <= 25 && n >= 1 && n <= 45 && isName(m[4]); }, name: (m) => m[4] },
    { type: 'student', label: '학년·반·번호', re: new RegExp(`[1-6]\\s*학년\\s*\\d{1,2}\\s*반(?:\\s*\\d{1,2}\\s*번)(?:\\s*(${NAME})${TAIL})?`, 'g'), name: (m) => m[1] || null },
    { type: 'student', label: '반과 이름', re: new RegExp(`[1-6]\\s*학년\\s*\\d{1,2}\\s*반\\s+(${NAME})\\s*(?:학생|군|양)`, 'g'), name: (m) => m[1] },
    { type: 'email', label: '이메일', re: /[A-Za-z0-9._%+-]{2,}@(?!github\.com)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, mask: () => '***@***' },
  ];
  // 파일 경로 속 글자는 바꾸면 파일을 못 찾는다 → 알려 주기만 하고 가리지 않는다
  const PATH = /(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>|?*]+?\.[A-Za-z0-9]{1,5}(?![A-Za-z0-9])/g;

  /** 글 → 찾은 것들 [{ type, label, value, at, name?, to, inPath }] (앞에서부터, 겹치지 않게) */
  function scan(text, students = new Map()) {
    const s = String(text || ''); const found = [];
    const taken = new Set(); // 이미 찾은 글자 자리(겹치지 않게)
    const paths = /[A-Za-z]:[\\/]|\\\\/.test(s) ? [...s.matchAll(PATH)].map((m) => [m.index, m.index + m[0].length]) : [];
    for (const r of RULES) for (const m of s.matchAll(r.re)) {
      if (r.ok && !r.ok(m)) continue;
      const at = m.index, end = at + m[0].length;
      if (taken.has(at) || taken.has(end - 1)) continue;
      for (let q = at; q < end; q++) taken.add(q);
      found.push({ type: r.type, label: r.label, value: m[0], at, end, name: r.name ? r.name(m) : undefined, rule: r, inPath: paths.some(([a, b]) => at >= a && end <= b) });
    }
    found.sort((a, b) => a.at - b.at);
    for (const f of found) {
      if (f.type === 'student') { const k = f.name || f.value.replace(/\s/g, ''); if (!students.has(k)) students.set(k, `[학생${students.size + 1}]`); f.to = students.get(k); } else f.to = f.rule.mask(f);
      delete f.rule;
    }
    return found;
  }
  /** 찾은 것을 가린 글. 학번과 함께 나온 이름은 글의 다른 자리에서도 같은 [학생N] 으로. */
  function mask(text, found = scan(text), { students = null } = {}) {
    let s = String(text || '');
    for (const f of [...found].filter((x) => !x.inPath).sort((a, b) => b.at - a.at)) s = s.slice(0, f.at) + f.to + s.slice(f.end);
    const names = new Map([...(students ? [...students].filter(([n]) => /^[가-힣]{2,4}$/.test(n)) : []), ...found.filter((x) => x.name && !x.inPath).map((x) => [x.name, x.to])]);
    if (names.size) {
      const one = new RegExp(`(?<![가-힣])(${[...names.keys()].sort((a, b) => b.length - a.length).join('|')})${TAIL}`, 'g');
      const parts = []; let last = 0; // 경로 안은 건드리지 않는다
      for (const m of s.matchAll(PATH)) { parts.push([s.slice(last, m.index), true], [m[0], false]); last = m.index + m[0].length; }
      parts.push([s.slice(last), true]);
      s = parts.map(([t, can]) => (can ? t.replace(one, (m, n) => names.get(n)) : t)).join('');
    }
    return s;
  }
  /** 이미 아는 학생 이름이 글에 나온 것들(경로 속은 뺌) */
  function mentions(text, students) {
    const ns = [...students.keys()].filter((n) => /^[가-힣]{2,4}$/.test(n)); if (!ns.length) return [];
    return [...String(text).replace(PATH, ' ').matchAll(new RegExp(`(?<![가-힣])(${ns.sort((a, b) => b.length - a.length).join('|')})${TAIL}`, 'g'))].map((m) => m[1]);
  }
  const allowed = new Set(); // 이 창에서 「그대로 보내기」를 고른 값은 다시 묻지 않는다
  /** 보내기 전 확인 → 보낼 글(가렸으면 바뀐 글) 또는 null(취소) */
  async function check(text) { const r = await checkAll(text, []); return r ? r.text : null; }
  /** 첨부 하나의 글자(데몬이 이 PC 에서 뽑음) — 같은 첨부는 한 번만 */
  const read = new Map();
  async function fileText(p) {
    if (!read.has(p)) read.set(p, (async () => { try { const r = await fetch('/api/privacy/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) }); return r.ok ? await r.json() : { kind: 'none', text: '' }; } catch { return { kind: 'none', text: '' }; } })());
    return read.get(p);
  }
  async function upload(name, text) {
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(name) }, body: new Blob(['\ufeff', text], { type: 'text/plain' }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || '가린 사본을 만들지 못했어요.'); return j.path;
  }
  /** 글 + 첨부({name,path}) 확인 → { text, paths } 또는 null(취소). 가리면 첨부는 글자만 뽑아 가린 사본으로 바꾼다(원본·다른 첨부는 그대로). */
  async function checkAll(text, files = []) {
    const students = new Map(); const found = scan(text, students).filter((f) => !allowed.has(f.value));
    const docs = []; const texts = [];
    for (const f of files) {
      if (allowed.has(`file:${f.path}`)) continue;
      const t = await fileText(f.path); const hits = t.kind === 'text' ? scan(t.text, students) : [];
      if (hits.length) docs.push({ f, text: t.text, hits, truncated: t.truncated });
      else if (t.kind === 'text') { texts.push({ f, t }); if (t.truncated) docs.push({ f, unread: true, truncated: true }); }
      else if (t.kind === 'none') docs.push({ f, unread: true });
    }
    // 다른 첨부·글에서 알게 된 학생 이름이 이름만 적혀 있는 첨부와 글(모두 훑은 뒤라 순서와 상관없다)
    for (const { f, t } of texts) { const k = mentions(t.text, students); if (!k.length) continue; const i = docs.findIndex((d) => d.f === f); if (i >= 0) docs.splice(i, 1); docs.push({ f, text: t.text, hits: k.map(() => ({ label: '이름' })), truncated: t.truncated }); }
    if (docs.some((d) => d.hits)) for (const n of new Set(mentions(text, students))) if (!found.some((x) => x.value.includes(n))) found.push({ type: 'student', label: '이름', value: n, to: students.get(n), inPath: false, nameOnly: true });
    const bad = docs.filter((d) => d.hits);
    if (!found.length && !bad.length) return { text, paths: files.map((f) => f.path) }; // 읽지 못한 파일만 있으면 귀찮게 묻지 않는다
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const can = bad.length > 0 || found.some((f) => !f.inPath); const list = found.slice(0, 8);
    const rows = list.map((f) => `<li><span>${esc(f.label)}</span><b>${esc(f.value)}</b><i>${f.inPath ? '파일 이름 속 — 가리지 않음' : `→ ${esc(f.to)}`}</i></li>`).join('');
    const count = (hits) => Object.entries(hits.reduce((o, h) => ({ ...o, [h.label]: (o[h.label] || 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(' · ');
    const frows = docs.map((d) => `<li class="pv-file"><b>${esc(d.f.name)}</b><i>${d.hits ? esc(count(d.hits)) : d.truncated ? '너무 길어 앞부분만 봤어요' : '읽지 못해 확인하지 못했어요'}</i></li>`).join('');
    const r = await Dialog.choose({ title: bad.length && !found.length ? '첨부 파일에 개인정보로 보이는 것이 있어요' : `개인정보로 보이는 것이 ${found.length + bad.reduce((n, d) => n + d.hits.length, 0)}개 있어요`, html: `<p>AI 회사 서버로 보내기 전에 확인해 주세요.</p>${rows ? `<ul class="pv-list">${rows}</ul>` : ''}${found.length > list.length ? `<p>그 밖에 ${found.length - list.length}개</p>` : ''}${frows ? `<p class="pv-h">첨부 파일</p><ul class="pv-list">${frows}</ul>` : ''}${bad.length ? '<p class="pv-n">가려서 보내면 첨부는 글자만 뽑은 텍스트 사본으로 바뀌어요. 원본은 그대로예요.</p>' : ''}`, okLabel: can ? (bad.length ? '가린 사본으로 보내기' : '가려서 보내기') : '그대로 보내기', extraLabel: can ? '그대로 보내기' : '', cancelLabel: '취소' });
    if (r === 'cancel') return null;
    if (r === 'extra' || !can) { for (const f of found) allowed.add(f.value); for (const d of bad) allowed.add(`file:${d.f.path}`); return { text, paths: files.map((f) => f.path) }; }
    const paths = []; let n = 0;
    for (const f of files) {
      const d = bad.find((x) => x.f === f); n++;
      if (!d) { paths.push(f.path); continue; }
      const body = mask(d.text, scan(d.text, students), { students }); const ext = (f.name.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0];
      paths.push(await upload(`가린 첨부 ${n}.txt`, `[첨부 ${n}${ext} 에서 글자만 뽑아 이름·번호를 가린 사본${d.truncated ? ' · 길어서 앞부분만' : ''}]\n\n${body}`)); // 파일 이름에 든 이름도 안 나가게 새 이름
    }
    return { text: mask(text, scan(text, students).filter((f) => !allowed.has(f.value)), { students: new Map([...students].filter(([k]) => !allowed.has(k))) }), paths };
  }
  const api = { scan, mask, check, checkAll, forget: (p) => read.delete(p) };
  if (typeof window !== 'undefined') window.PrivacyCheck = api;
  if (typeof globalThis !== 'undefined') globalThis.__irisPrivacy = api; // 시험(scripts/check-privacy.mjs)
})();

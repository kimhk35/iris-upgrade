// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 예약 실행 화면(설정 → 세션 기본값) · 놓친 예약 물음(P18 2026-11-24 고도화 9번). 규칙·권한은 데몬 schedule.mjs. */
window.Schedule = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const D = ['일', '월', '화', '수', '목', '금', '토'], AG = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', local: '로컬' };
  let opts = {}, host = null, list = [], edit = null, asking = false, folders = [];
  const call = async (op, body) => { const r = await fetch(`/api/schedule${op}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(opts.headers?.() || {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.error || '하지 못했어요.'); return j; };
  const when = (s) => `${!s.days.length ? '매일' : String(s.days) === '1,2,3,4,5' ? '평일' : `매주 ${s.days.map((d) => D[d]).join('·')}`} ${s.time}`;
  const date = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일(${D[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  async function load(ask) { try { list = (await call('')).list || []; } catch { list = []; } draw(); if (ask) missed(); }
  function draw() {
    if (!host || (edit && host.contains(document.activeElement))) return;
    const rows = list.map((s) => `<div class="st-opt sch"><span class="st-opt-text">${esc(s.name)}<small>${esc(when(s))} · ${esc(String(s.cwd).split(/[\\/]/).pop())} · ${AG[s.agent] || esc(s.agent)}${s.enabled && s.next ? ` · 다음 ${date(s.next)}` : ''}</small>${s.lastError ? `<small class="sch-err">${esc(s.lastError)}</small>` : ''}</span><span class="st-line"><button type="button" class="text-btn outline" data-sc="run" data-id="${s.id}">지금 해 보기</button><button type="button" class="text-btn outline" data-sc="edit" data-id="${s.id}">고치기</button><input class="sw" type="checkbox" data-sc="on" data-id="${s.id}" aria-label="${esc(s.name)} 켜기"${s.enabled ? ' checked' : ''}></span></div>`).join('');
    host.innerHTML = `${rows || '<p class="st-hint">아직 예약이 없어요.</p>'}${edit ? form() : '<div class="sch-add"><button type="button" class="text-btn outline" data-sc="new">＋ 예약 더하기</button></div>'}<p class="st-hint">IRIS가 켜져 있을 때만 실행하고 구독 사용량을 씁니다. 보는 사람이 없으므로 작업 폴더의 파일을 만들고 고치는 데까지만 저절로 하고, 그 밖의 명령이 필요하면 멈추고 확인을 기다립니다.</p>`;
  }
  function form() {
    const e = edit, models = opts.agents?.()[e.agent]?.models || [];
    return `<div class="sch-form"><label class="tl-l">이름<input class="tl-in" data-f="name" maxlength="40" value="${esc(e.name)}"></label><label class="tl-l">보낼 요청<textarea class="tl-in" data-f="prompt" rows="4" maxlength="8000">${esc(e.prompt)}</textarea></label>
      <label class="tl-l">작업 폴더<input class="tl-in" data-f="cwd" list="sch-dirs" spellcheck="false" value="${esc(e.cwd)}"><datalist id="sch-dirs">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></label>
      <div class="sch-row"><label class="tl-l">시각<input class="tl-in" type="time" data-f="time" value="${esc(e.time)}"></label><label class="tl-l">AI<select class="tl-in" data-f="agent">${Object.keys(opts.agents?.() || AG).map((a) => `<option value="${a}"${a === e.agent ? ' selected' : ''}>${AG[a] || a}</option>`).join('')}</select></label><label class="tl-l">모델<select class="tl-in" data-f="model">${models.map((m) => `<option value="${esc(m.id)}"${m.id === e.model ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label></div>
      <div class="sch-days" role="group" aria-label="요일(고르지 않으면 매일)">${D.map((n, i) => `<button type="button" class="cv-chip${e.days.includes(i) ? ' on' : ''}" data-day="${i}" aria-pressed="${e.days.includes(i)}">${n}</button>`).join('')}<small>고르지 않으면 매일</small></div>
      <div class="tl-foot">${e.id ? '<button type="button" class="text-btn danger" data-sc="del">지우기</button>' : ''}<span class="cv-sp"></span><button type="button" class="text-btn" data-sc="cancel">취소</button><button type="button" class="text-btn accent" data-sc="save">저장</button></div></div>`;
  }
  function read() { for (const i of host.querySelectorAll('[data-f]')) edit[i.dataset.f] = i.value; }
  const redraw = () => { document.activeElement?.blur?.(); draw(); };
  async function act(b) {
    const a = b.dataset.sc, s = list.find((x) => x.id === b.dataset.id);
    try {
      if (a === 'new' || a === 'edit') { try { folders = ((await (await fetch('/api/folders')).json()).recent || []).map((r) => r.path || r.cwd || r).filter((x) => typeof x === 'string').slice(0, 12); } catch {} edit = s ? { ...s, days: [...s.days] } : { name: '', prompt: opts.draft?.() || '', cwd: opts.cwd?.() || folders[0] || '', time: '08:00', days: [], agent: 'claude', model: '', effort: '', enabled: true }; redraw(); return $('[data-f=name]', host)?.focus(); }
      if (a === 'cancel') { edit = null; return redraw(); }
      if (a === 'save') { read(); const safe = await PrivacyCheck.check(edit.prompt); if (safe == null) return; edit.prompt = safe; await call('/save', edit); edit = null; document.activeElement?.blur?.(); return load(); }
      if (a === 'del') { if (!(await Dialog.confirm(`예약 「${edit.name}」을 지울까요?`, { okLabel: '지우기', danger: true }))) return; await call('/remove', { id: edit.id }); edit = null; document.activeElement?.blur?.(); return load(); }
      if (a === 'on') { await call('/save', { ...s, enabled: b.checked }); return load(); }
      if (a === 'run') { if (!(await Dialog.confirm(`「${s.name}」을 지금 새 대화로 실행할까요?`, { okLabel: '실행' }))) return; await call('/answer', { id: s.id, go: true }); return load(); }
    } catch (e) { Dialog.alert(e.message); load(); }
  }
  /** 놓친 예약: 하나씩 묻는다(저절로 돌리지 않음) */
  async function missed() {
    if (asking) return; asking = true;
    try { for (const s of list.filter((x) => x.missedAt && x.enabled)) { const go = await Dialog.confirm(`IRIS가 꺼져 있어 놓친 예약이 있어요.\n\n${s.name}\n${date(s.missedAt)}\n\n지금 실행할까요?`, { title: '놓친 예약', okLabel: '지금 실행', cancelLabel: '건너뛰기' }); await call('/answer', { id: s.id, go }).catch(() => {}); } }
    finally { asking = false; load(); }
  }
  function init(o) {
    opts = o; host = $('#st-sched');
    host?.addEventListener('click', (e) => { const d = e.target.closest('[data-day]'); if (d) { read(); const k = Number(d.dataset.day); edit.days = edit.days.includes(k) ? edit.days.filter((x) => x !== k) : [...edit.days, k].sort(); return redraw(); } const b = e.target.closest('button[data-sc]'); if (b) act(b); });
    host?.addEventListener('change', (e) => { if (e.target.dataset.sc === 'on') return act(e.target); if (e.target.dataset.f === 'agent') { read(); edit.model = ''; redraw(); } });
    setTimeout(() => load(true), 6000);
  }
  return { init, onChange: () => load(true), refresh: () => load() };
})();

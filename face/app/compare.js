// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 두 AI 답 나란히 견주기(P18 2026-11-25 4차 10번): 같은 질문을 두 AI 에 보내 나란히 본다. 두 쪽 모두 보통 대화(작업목록에 남음)이고,
   같은 폴더를 함께 고치지 않게 「글로만 답하기」(Claude 계획만 · Codex 읽기 전용 · Gemini 계획만)로 연다. 구독 사용량을 두 배로 쓴다고 먼저 알린다. */
window.Compare = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NAME = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', local: '로컬 AI' };
  const HEAD = '[두 AI 견주기] 파일을 만들거나 고치지 말고, 프로그램을 실행하지 말고, 아래 질문에 글로만 답해 주세요.\n\n';
  const SAFE = { claude: { permission: 'plan' }, codex: { approval: 'never', sandbox: 'read-only' }, gemini: { mode: 'plan' }, local: {} };
  let box = null, opts = {}, side = [], timer = 0, busy = false;
  const isOpen = () => !!box && !box.hidden;
  const KEY = 'iris.compare';
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };

  function build() {
    box = document.createElement('div'); box.id = 'compare'; box.className = 'cmp'; box.hidden = true;
    box.innerHTML = `<div class="cmp-box" role="dialog" aria-modal="true" aria-label="두 AI 견주기">
      <div class="cmp-head"><b>두 AI 견주기</b><span class="cmp-folder"></span><span class="cv-sp"></span><button type="button" class="icon-btn" data-c="close" title="닫기 (Esc)">✕</button></div>
      <div class="cmp-cols">${[0, 1].map((i) => `<section class="cmp-col" data-i="${i}"><div class="cmp-top"><select class="pick" data-agent aria-label="${i + 1}번째 AI"></select><select class="pick" data-model aria-label="${i + 1}번째 모델"></select><span class="cmp-st"></span><span class="cv-sp"></span><button type="button" class="text-btn outline" data-c="go" hidden>이 대화로 이어 가기</button></div><div class="cmp-chat"></div></section>`).join('')}</div>
      <div class="cmp-foot"><textarea class="cmp-q" rows="2" placeholder="두 AI에 함께 물어볼 것" spellcheck="false"></textarea><button type="button" class="text-btn accent" data-c="ask">함께 묻기</button></div>
      <p class="cmp-note">같은 질문을 두 번 보내므로 구독 사용량도 두 배예요. 파일은 고치지 않고 글로만 답해요. 두 대화는 작업목록에 남아요.</p></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (c === 'close') return void close(); if (c === 'ask') return void ask();
      if (c === 'go') { const s = side[Number(e.target.closest('.cmp-col').dataset.i)]; if (s?.id) { close(); opts.pick(s.id); } }
    });
    box.addEventListener('change', (e) => { const col = e.target.closest('.cmp-col'); if (!col) return; const s = side[Number(col.dataset.i)]; if (e.target.matches('[data-agent]')) { s.agent = e.target.value; s.model = ''; } else s.model = e.target.value; pickers(); try { localStorage.setItem(KEY, JSON.stringify({ a: side.map((x) => ({ agent: x.agent, model: x.model })) })); } catch {} });
    box.addEventListener('keydown', (e) => {
      if (e.target.matches('.cmp-q') && e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); ask(); }
      if (e.key !== 'Escape') e.stopPropagation();
    });
  }
  function pickers() {
    const A = opts.agents() || {}, off = opts.off() || {}, ids = Object.keys(A).filter((k) => !off[k]);
    side.forEach((s, i) => {
      const col = $(`.cmp-col[data-i="${i}"]`, box); if (!ids.includes(s.agent)) s.agent = ids.find((k) => k !== side[1 - i]?.agent) || ids[0];
      const list = A[s.agent]?.models || []; if (!list.some((m) => m.id === s.model)) s.model = A[s.agent]?.default?.model || list[0]?.id || '';
      const ag = $('[data-agent]', col), md = $('[data-model]', col);
      ag.innerHTML = ids.map((k) => `<option value="${k}">${NAME[k] || esc(k)}</option>`).join(''); ag.value = s.agent;
      md.innerHTML = list.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join(''); md.value = s.model;
      ag.disabled = md.disabled = !!s.id; $('[data-c="go"]', col).hidden = !s.id;
    });
    $('[data-c="ask"]', box).textContent = side.some((s) => s.id) ? '이어서 함께 묻기' : '함께 묻기';
  }
  function state() {
    side.forEach((s, i) => {
      const r = s.id && opts.session(s.id), st = $(`.cmp-col[data-i="${i}"] .cmp-st`, box);
      st.textContent = s.error ? `보내지 못했어요: ${s.error}` : !s.id ? '' : !r ? '목록에서 지워졌어요' : r.status === 'busy' ? '답하는 중…' : r.status === 'attention' ? '확인이 필요해요 — 「이 대화로 이어 가기」' : r.status === 'exited' || r.status === 'dead' ? '끝난 대화' : s.n ? '답했어요' : '여는 중…';
      st.classList.toggle('warn', !!s.error || r?.status === 'attention'); s.view?.setBusy(r?.status === 'busy');
    });
  }
  async function pull(s) {
    if (!s.id || s.pulling) return; s.pulling = true; const id = s.id;
    try {
      const r = await fetch(`/api/sessions/${id}/transcript`, { headers: opts.headers() }); const j = await r.json(); if (!r.ok || id !== s.id) return;
      const items = j.items || []; if (items.length < s.n) { s.n = 0; s.view.clear(); }
      if (items.length > s.n) { if (s.n) s.view.append(items.slice(s.n), j.meta); else s.view.render(items, j.meta); s.n = items.length; }
    } catch {} finally { s.pulling = false; }
  }
  function tick() { if (!isOpen()) { clearInterval(timer); timer = 0; return; } for (const s of side) pull(s); state(); }
  async function ask() {
    const q = $('.cmp-q', box); let text = q.value.trim(); if (!text || busy) return;
    const folder = opts.folder(); if (!folder && !side.some((s) => s.id)) { await Dialog.alert('먼저 입력창 위에서 폴더를 골라 주세요.'); return; }
    if (!side.some((s) => s.id) && side[0].agent === side[1].agent && side[0].model === side[1].model) { await Dialog.alert('두 쪽이 같은 AI·모델이에요. 한쪽을 바꿔 주세요.'); return; }
    busy = true; const btn = $('[data-c="ask"]', box); btn.disabled = true;
    try {
      text = await opts.guard(text, side.map((s) => s.agent)); if (text == null) return;
      await Promise.all(side.map(async (s, i) => {
        s.error = '';
        try {
          if (s.id) { await opts.api('POST', `/api/sessions/${s.id}/send`, { text }); s.view.pend(text); }
          else {
            const m = (opts.agents()[s.agent].models || []).find((x) => x.id === s.model);
            const rec = await opts.api('POST', '/api/sessions', { cwd: folder.path, agent: s.agent, model: s.model, expectModel: m?.actual ?? null, effort: opts.effort(s.agent, s.model), permission: '', approval: '', sandbox: '', mode: '', ...SAFE[s.agent], prompt: HEAD + text });
            s.id = rec.id; s.view.clear(); s.view.prime(text);
            opts.api('POST', `/api/sessions/${rec.id}/title`, { title: `견주기 ${i + 1} · ${text.replace(/\s+/g, ' ').slice(0, 30)}` }).catch(() => {});
          }
        } catch (e) { s.error = e.message; }
      }));
      if (side.some((s) => !s.error)) q.value = ''; pickers(); state();
      if (!timer) timer = setInterval(tick, 1200);
    } finally { busy = false; btn.disabled = false; q.focus(); }
  }
  function open(text = '') {
    if (!box) build();
    const keep = saved().a || []; const A = Object.keys(opts.agents() || {}), off = opts.off() || {}, on = A.filter((k) => !off[k]);
    if (on.length < 1) return Dialog.alert('쓸 수 있는 AI가 없어요.');
    for (const s of side) s.view?.clear();
    side = [0, 1].map((i) => { const host = $(`.cmp-col[data-i="${i}"] .cmp-chat`, box); host.innerHTML = ''; const v = Transcript.create(); v.mount(host); return { agent: keep[i]?.agent || on[i] || on[0], model: keep[i]?.model || '', id: null, n: 0, view: v, error: '' }; });
    $('.cmp-folder', box).textContent = opts.folder() ? `폴더 · ${opts.folder().name}` : '폴더를 아직 고르지 않았어요';
    $('.cmp-q', box).value = text; pickers(); state(); box.hidden = false; $('.cmp-q', box).focus();
  }
  function close() { if (!isOpen()) return false; box.hidden = true; clearInterval(timer); timer = 0; $('#composer-text')?.focus(); return true; }
  return { init: (o) => { opts = o; }, open, close, isOpen, _state: () => side };
})();

// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 캔버스(P18 고도화, 2026-11-12 사용자 결정 = 시안 B「오른쪽 나란히」): AI 가 지금 만들거나 고치는 파일을 대화 옆에서 계속 보여 준다.
   ① 저절로 열림 — 세션 기록의 도구 항목(it.files: 데몬 transcript.mjs writtenFiles)과 대화 글 속 절대 경로에서 미리볼 수 있는 파일을 모아 탭으로.
      세션에서 처음 파일이 생기면 한 번 저절로 열린다(사용자가 닫았으면 다시 열지 않고 머리줄 단추에 숫자만).
   ② 실시간 새로고침 — 열려 있고 창이 보일 때만 지금 탭의 바뀜 시각(/api/file/stat)을 1.5초마다 보고, 바뀌면 다시 그린다(「방금 바뀜」).
      「따라가기」가 켜져 있으면 가장 최근에 쓴 파일로 자동 이동.
   ③ 눌러서 고치기 — HTML 은 「고르기」를 켜면 데몬이 격리된 미리보기에 작은 스크립트를 붙여(/api/fs/…?pick=1) 누른 곳의 글자를 postMessage 로 알린다.
      「이 부분 고쳐 줘」는 입력창에 요청 머리말을 넣기만 한다(보내기는 사용자).
   ④ 세션마다 따로 — 탭·지금 탭·열림 여부를 세션별로 localStorage 에 기억.
   ⑤ 안전 — 미리보기는 데몬이 격리(CSP sandbox, IRIS 와 다른 출처)해 내준다. iframe 에도 allow-same-origin 을 주지 않는다.
   ⑥ Ctrl+Shift+K 열기·닫기(Ctrl+Shift+V 는 「서식 없이 붙여넣기」와 겹쳐 쓰지 않음). 좁은 창(대화 칸 900px 미만)은 떠 있는 창. */
window.Canvas = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'iris.canvas';
  const POLL_MS = 1500;
  const KIND = (p) => {
    const e = (String(p).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (e === 'html' || e === 'htm') return 'html';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(e)) return 'img';
    if (e === 'pdf') return 'pdf';
    if (['hwp', 'hwpx', 'doc', 'docx', 'rtf', 'odt', 'xls', 'xlsx', 'xlsm', 'ods', 'ppt', 'pptx', 'odp'].includes(e)) return 'doc';
    if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'css', 'scss', 'json', 'md', 'txt', 'csv', 'tsv', 'xml', 'yml', 'yaml', 'toml', 'ini', 'ps1', 'cmd', 'bat', 'sh', 'sql', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'kt', 'swift', 'vue', 'svelte', 'tex', 'r', 'lua'].includes(e)) return 'text';
    return null;
  };
  // 대화 글 속 절대 경로(미리볼 수 있는 것만) — app/transcript.js 의 삽입 규칙과 같은 모양
  const PATH_RE = /(?:\/|file:\/\/\/)?[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n`]+[\\/])*[^\\/:*?"<>|\r\n`]*?\.(?:html?|png|jpe?g|gif|webp|svg|bmp|pdf|hwpx?|docx?|xlsx?|pptx?)(?!\w)/gi;
  const norm = (p) => String(p).replace(/^file:\/\/\//i, '').replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
  const isAbs = (p) => /^[A-Za-z]:[\\/]/.test(p);
  const join = (dir, rel) => { const parts = []; for (const s of `${dir}\\${rel}`.split(/[\\/]+/)) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); } return parts.join('\\'); };
  const fsUrl = (p, q = '') => `/api/fs/${norm(p).split('\\').map(encodeURIComponent).join('/')}${q}`;
  const base = (p) => norm(p).split('\\').pop();

  let composer = null, host = null, wrap = null, toggleBtn = null;
  let sid = null, cwd = '', open = false, pick = false, timer = 0, lastMtime = null;
  const store = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
  const S = () => {
    if (!sid) return null;
    const s = store.sessions ||= {};
    return s[sid] ||= { files: [], cur: null, follow: true, autoOpened: false, closedByUser: false, open: false };
  };

  // ── 파일 모으기 ──
  function add(path, { written, at }) {
    const st = S(); if (!st) return false;
    const p = norm(isAbs(path) ? path : (cwd ? join(cwd, path) : path));
    if (!isAbs(p) || !KIND(p)) return false;
    let f = st.files.find((x) => x.path.toLowerCase() === p.toLowerCase());
    if (!f) { f = { path: p, kind: KIND(p), changed: 0 }; st.files.unshift(f); if (st.files.length > 30) st.files.length = 30; }
    if (written) {
      f.changed = Date.now(); f.at = at || f.at;
      if (st.follow || !st.cur) st.cur = f.path;
      if (st.cur !== f.path) f.unseen = true;
    } else if (!st.cur) st.cur = f.path;
    return written;
  }
  /** 세션 기록 항목이 들어올 때(main.js: 처음 읽기·실시간 추가). reset 이면 그 세션 목록을 기록 기준으로 다시 모은다(기억한 지금 탭은 유지). */
  function onItems(id, items, reset, dir) {
    if (!id || id === 'preview' || id !== sid) return;
    if (dir) cwd = dir;
    const st = S(); if (!st) return;
    let wrote = false;
    for (const it of items || []) {
      if (it.kind === 'tool' && Array.isArray(it.files)) for (const f of it.files) wrote = add(f, { written: !reset, at: it.t }) || wrote;
      if (it.kind === 'assistant' && it.text) for (const m of String(it.text).matchAll(PATH_RE)) add(m[0], { written: false });
    }
    // 처음 파일이 생긴 세션은 한 번 저절로 연다(사용자가 닫았으면 존중)
    if (st.files.length && !st.autoOpened && !st.closedByUser && !open) { st.autoOpened = true; save(); show(true); return; }
    save(); render(wrote);
  }
  function onSession(id, dir) {
    sid = id && id !== 'preview' ? id : null; cwd = dir || '';
    const st = S();
    if (!sid) { setOpen(false, { quiet: true }); return renderToggle(); }
    setOpen(!!st.open, { quiet: true }); render(true);
  }

  // ── 그리기 ──
  function ensure() {
    if (host) return;
    wrap = $('#chat-wrap');
    host = document.createElement('aside'); host.id = 'canvas'; host.className = 'canvas'; host.hidden = true;
    host.innerHTML = `<div class="cv-resize" title="끌어서 너비 조절 · 두 번 클릭 = 기본 너비"></div>
      <div class="cv-head"><span class="cv-t">캔버스</span><span class="cv-live" title="파일이 바뀌면 저절로 다시 그립니다">실시간</span><span class="cv-sp"></span>
        <button type="button" class="cv-chip" data-cv="follow" title="가장 최근에 쓴 파일로 자동 이동">따라가기</button>
        <button type="button" class="cv-chip" data-cv="pick" title="미리보기에서 고칠 곳을 눌러 고릅니다(HTML)">고르기</button>
        <button type="button" class="cv-chip" data-cv="app" title="이 PC의 프로그램(파워포인트·워드·한/글 등)으로 원본 열기" hidden>원본 열기</button>
        <button type="button" class="icon-btn" data-cv="ext" title="새 창에서 열기">⧉</button>
        <button type="button" class="icon-btn" data-cv="close" title="닫기 (Ctrl+Shift+K)">✕</button></div>
      <div class="cv-tabs" role="tablist"></div>
      <div class="cv-view"></div>
      <div class="cv-foot"><span class="cv-fl">고칠 곳</span><input type="text" class="cv-pickin" placeholder="HTML 은 「고르기」를 켜고 미리보기를 누르세요 · 직접 적어도 됩니다" spellcheck="false"><button type="button" class="cv-go" data-cv="ask">이 부분 고쳐 줘</button></div>`;
    wrap.appendChild(host);
    host.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-cvfile]'); if (tab) { const st = S(); st.cur = tab.dataset.cvfile; const f = st.files.find((x) => x.path === st.cur); if (f) f.unseen = false; save(); return render(true); }
      const b = e.target.closest('[data-cv]'); if (!b) return;
      const a = b.dataset.cv, st = S();
      if (a === 'close') return show(false, { user: true });
      if (a === 'follow') { st.follow = !st.follow; save(); return render(false); }
      if (a === 'pick') { pick = !pick; return render(true); }
      if (a === 'ext' && st?.cur) return window.open(curKind() === 'doc' ? `/api/doc?path=${encodeURIComponent(st.cur)}` : fsUrl(st.cur), '_blank');
      if (a === 'app' && st?.cur) return void fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: st.cur }) });
      if (a === 'ask') return ask();
    });
    host.querySelector('.cv-pickin').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ask(); } });
    // 너비 끌기(대화 칸 비율로 기억)
    const rz = host.querySelector('.cv-resize');
    rz.addEventListener('dblclick', () => { store.w = null; save(); applyWidth(); });
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault(); rz.setPointerCapture(e.pointerId); const box = wrap.getBoundingClientRect(); host.classList.add('cv-dragging');
      const mv = (ev) => { store.w = Math.max(0.25, Math.min(0.75, (box.right - ev.clientX) / box.width)); applyWidth(); };
      const up = () => { rz.removeEventListener('pointermove', mv); host.classList.remove('cv-dragging'); save(); };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up, { once: true });
    });
    new ResizeObserver(() => layout()).observe(wrap);
    // 「고르기」 결과: 지금 보이는 미리보기에서 온 말만 받는다(격리된 다른 출처라 출처 대신 보낸 창으로 확인)
    window.addEventListener('message', (e) => {
      const fr = host.querySelector('.cv-view iframe');
      if (!fr || e.source !== fr.contentWindow || e.data?.type !== 'iris-pick') return;
      const inp = host.querySelector('.cv-pickin'); inp.value = String(e.data.text || e.data.selector || '').slice(0, 200); inp.dataset.sel = String(e.data.selector || '').slice(0, 200); inp.focus();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && open) check(); });
  }
  function applyWidth() { if (wrap) wrap.style.setProperty('--cv-w', `${Math.round((store.w || 0.46) * 100)}%`); }
  function layout() { if (!wrap || !host) return; wrap.classList.toggle('cv-float', wrap.clientWidth < 900); }
  const curKind = () => KIND(S()?.cur || '');

  function renderToggle() {
    if (!toggleBtn) return;
    const st = S(), n = st?.files.length || 0, unseen = st?.files.filter((f) => f.unseen).length || 0;
    toggleBtn.hidden = !sid;
    toggleBtn.classList.toggle('on', open);
    toggleBtn.querySelector('b').textContent = n ? String(n) : '';
    toggleBtn.classList.toggle('fresh', !open && unseen > 0);
    toggleBtn.title = `캔버스 ${open ? '닫기' : '열기'} (Ctrl+Shift+K)${n ? ` · 파일 ${n}개` : ''}`;
  }
  function render(reload) {
    renderToggle();
    if (!host || !open) return;
    const st = S(); if (!st) return;
    host.querySelector('[data-cv="follow"]').classList.toggle('on', !!st.follow);
    const kind = curKind();
    const pb = host.querySelector('[data-cv="pick"]'); pb.hidden = kind !== 'html'; pb.classList.toggle('on', pick && kind === 'html');
    host.querySelector('[data-cv="app"]').hidden = kind !== 'doc';
    host.querySelector('.cv-tabs').innerHTML = st.files.length
      ? st.files.map((f) => `<button type="button" role="tab" class="cv-tab${f.path === st.cur ? ' cur' : ''}${f.unseen ? ' new' : ''}" data-cvfile="${esc(f.path)}" title="${esc(f.path)}">${esc(base(f.path))}</button>`).join('')
      : '';
    host.querySelector('.cv-go').textContent = kind === 'html' ? '이 부분 고쳐 줘' : '이 파일 고쳐 줘';
    if (reload) { lastMtime = null; draw(); }
  }
  async function draw(mtime) {
    const view = host.querySelector('.cv-view'), st = S(), p = st?.cur, kind = curKind();
    if (!p) { view.innerHTML = `<div class="cv-empty">AI 가 HTML·그림·PDF·한글·워드·코드 파일을 만들거나 고치면 여기에 바로 보입니다.</div>`; return; }
    // 그리기 전에 그 파일의 바뀜 시각을 재어 기준으로 삼는다 — 그린 뒤 첫 확인까지의 틈에 바뀐 것을 놓치지 않게(P18 검사에서 발견)
    if (mtime == null) { try { const j = await (await fetch(`/api/file/stat?path=${encodeURIComponent(p)}`)).json(); if (j.exists) mtime = j.mtime; } catch {} if (p !== S()?.cur) return; }
    lastMtime = mtime ?? null;
    const v = `?v=${Math.round(mtime || Date.now())}`;
    if (kind === 'html') view.innerHTML = `<iframe class="cv-frame" sandbox="allow-scripts allow-popups allow-forms allow-modals" src="${fsUrl(p, v + (pick ? '&pick=1' : ''))}" title="${esc(base(p))}"></iframe>`;
    else if (kind === 'img') view.innerHTML = `<div class="cv-img"><img src="${fsUrl(p, v)}" alt="${esc(base(p))}"></div>`;
    else if (kind === 'pdf') view.innerHTML = `<iframe class="cv-frame" src="${fsUrl(p, v)}" title="${esc(base(p))}"></iframe>`;
    else if (kind === 'doc') view.innerHTML = `<div class="cv-wait">미리보기를 만드는 중… (처음에는 10초쯤 걸려요)</div><iframe class="cv-frame" src="/api/doc?path=${encodeURIComponent(p)}&v=${Math.round(mtime || Date.now())}#navpanes=0&view=FitH" title="${esc(base(p))}" onload="this.previousElementSibling&&this.previousElementSibling.remove()"></iframe>`;
    else {
      try {
        const r = await fetch(`/api/file/text?path=${encodeURIComponent(p)}`); const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        const lines = String(j.text).split(/\r?\n/);
        view.innerHTML = `<pre class="cv-code">${lines.map((l, i) => `<span class="ln">${i + 1}</span>${esc(l)}`).join('\n')}</pre>${j.truncated ? '<div class="cv-note">파일이 커서 앞부분만 보입니다</div>' : ''}`;
      } catch (e) { view.innerHTML = `<div class="cv-empty">이 파일을 열지 못했습니다(${esc(e.message)})</div>`; }
    }
  }
  // ── 실시간: 지금 탭의 바뀜 시각 ──
  async function check() {
    const p = S()?.cur; if (!open || !p || document.hidden) return;
    let j; try { j = await (await fetch(`/api/file/stat?path=${encodeURIComponent(p)}`)).json(); } catch { return; }
    if (p !== S()?.cur) return;
    if (!j.exists) { host.querySelector('.cv-live').classList.add('off'); return; }
    host.querySelector('.cv-live').classList.remove('off');
    if (lastMtime === null) { lastMtime = j.mtime; return; }
    if (j.mtime !== lastMtime) {
      await draw(j.mtime);
      const fl = document.createElement('span'); fl.className = 'cv-flash'; fl.textContent = '방금 바뀜'; host.querySelector('.cv-view').appendChild(fl); setTimeout(() => fl.remove(), 1800);
    }
  }
  function setOpen(v, { quiet } = {}) {
    ensure(); open = !!v && !!sid;
    host.hidden = !open; wrap.classList.toggle('cv-on', open);
    clearInterval(timer); timer = open ? setInterval(check, POLL_MS) : 0;
    applyWidth(); layout();
    if (!quiet) { const st = S(); if (st) { st.open = open; save(); } }
  }
  function show(v, { user } = {}) {
    if (!sid) return;
    const st = S(); if (user && !v) st.closedByUser = true; if (v) st.closedByUser = false;
    setOpen(v); render(true);
  }
  function ask() {
    const st = S(); if (!st?.cur || !composer) return;
    const inp = host.querySelector('.cv-pickin'), what = inp.value.trim();
    const head = curKind() === 'html' && what
      ? `[캔버스] ${st.cur} 에서 「${what}」${inp.dataset.sel ? ` (위치: ${inp.dataset.sel})` : ''} 부분을 이렇게 고쳐 줘: `
      : `[캔버스] ${st.cur} 파일을 이렇게 고쳐 줘: ${what ? what + ' — ' : ''}`;
    composer.value = (composer.value.trim() ? composer.value.trimEnd() + '\n' : '') + head;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    composer.focus(); composer.setSelectionRange(composer.value.length, composer.value.length);
    inp.value = ''; delete inp.dataset.sel;
  }

  function init(o = {}) {
    composer = o.composer || null;
    ensure();
    // 대화 화면 머리줄 단추(모드 단추 앞)
    const head = $('#view-head'), anchor = head?.querySelector('.seg');
    if (head) {
      toggleBtn = document.createElement('button'); toggleBtn.type = 'button'; toggleBtn.className = 'icon-btn cv-toggle'; toggleBtn.hidden = true;
      toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M13 4v16"/></svg><b></b>';
      toggleBtn.addEventListener('click', () => show(!open, { user: true }));
      head.insertBefore(toggleBtn, anchor || null);
    }
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (sid) show(!open, { user: true }); } });
  }
  return { init, onItems, onSession, show, isOpen: () => open, _state: () => ({ sid, cwd, open, pick, st: S() }) };
})();

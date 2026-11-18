// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 설정 → 「도구」(판 B, 2026-11-10 — 설계 = docs\설계-도구화면-2026-11-10.md; 옛 v2.90~v2.92 읽기 전용 화면을 대체).
   탭 셋 Skill · MCP · Plugin. 탭마다 「설치됨」 / 「설치할 수 있음」 두 묶음, 위에 에이전트 탭(전체·Claude 전용·Codex 전용·둘 다)과 찾기.
   한 줄 = 아이콘 · 이름 · 한 줄 설명 · 에이전트 칩 · 상태/버튼:
     IRIS 가 깐 것(장부) → 「제거」 · 엄선 목록의 안 깐 것 → 「설치」 · 기본 도구 → 「기본」 표시만 · 손으로 깐 것 → 「직접 설치함」 표시만.
   설치·제거는 데몬 POST /api/tools/{install,remove}(같은 출처·한 번에 하나), 진행은 ws {type:'tools'} 로 받는다.
   자료 = GET /api/tools(설치된 목록 + origin + catalog). MCP 는 이름·종류·실행 파일 이름만 온다(env·인자 값 없음). */
window.ToolsView = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY_TAB = 'iris.tools.kind';
  let host = null, data = null, loaded = false, q = '', agent = 'all', busy = null, acting = null;
  let kind = (() => { try { return localStorage.getItem(KEY_TAB) || 'skills'; } catch { return 'skills'; } })();
  const KINDS = [
    { key: 'skills', cat: 'skill', title: 'Skill', icon: 'book', desc: '정해진 일을 잘하는 요령을 묶어 둔 설명서 — 에이전트가 필요할 때 펼쳐 봅니다' },
    { key: 'mcp', cat: 'mcp', title: 'MCP', icon: 'plug', desc: '에이전트용 콘센트 — 꽂으면 다른 프로그램·서비스를 직접 다룹니다' },
    { key: 'plugins', cat: 'plugin', title: 'Plugin', icon: 'bolt', desc: 'Skill·MCP·명령을 한 묶음으로 설치하는 것' },
  ];
  if (!KINDS.some(k => k.key === kind)) kind = 'skills';
  const AGENTS = [['all', '전체'], ['claude', 'Claude 전용'], ['codex', 'Codex 전용'], ['both', '둘 다']];
  const chip = (a) => `<span class="chip ${a === 'codex' ? 'codex' : 'claude'}">${a === 'codex' ? 'Codex' : 'Claude'}</span>`;
  const whose = (agents) => agents.length > 1 ? 'both' : agents[0] === 'codex' ? 'codex' : 'claude';
  const byAgent = (rows) => agent === 'all' ? rows : rows.filter(r => whose(r.agents) === agent);
  const K = () => KINDS.find(k => k.key === kind);

  /** 설치된 줄: 같은 이름·같은 출처끼리 묶어 에이전트를 모은다. */
  function installedRows(k) {
    const m = new Map();
    for (const it of (data?.[k.key] || [])) {
      const key = `${String(it.catalogId || it.dir || it.name).toLowerCase()}|${it.origin || 'manual'}|${it.market || ''}`;
      const cur = m.get(key);
      if (cur) { if (!cur.agents.includes(it.agent)) cur.agents.push(it.agent); if (it.enabled === false) cur.off.push(it.agent); }
      else m.set(key, { ...it, agents: [it.agent], off: it.enabled === false ? [it.agent] : [] });
    }
    return [...m.values()];
  }
  const catItems = (k) => (data?.catalog?.items || []).filter(i => i.kind === k.cat);
  const catById = (id) => (data?.catalog?.items || []).find(i => i.id === id) || null;
  // 내 MCP(P18): 장부의 custom 항목을 확인 창·제거가 쓰는 모양으로
  const customById = (id) => { const c = (data?.catalog?.custom || []).find(x => x.id === id); return c ? { ...c, name: c.id, desc: '내가 추가한 MCP', agents: c.agents.length ? c.agents : ['claude'] } : null; };
  const iconOf = (it, k) => it?.icon ? `<img class="tl-ic" src="/app/tool-icons/${esc(it.icon)}" alt="" draggable="false">` : `<span class="tl-ic tl-ic-k">${Icons.svg(k.icon, 22)}</span>`;
  const line = (row, k) => {
    if (k.key === 'mcp') return [row.kind === 'http' ? '인터넷 주소로 연결' : '이 컴퓨터에서 실행', row.program].filter(Boolean).join(' · ');
    if (k.key === 'plugins') return [row.market && `출처 ${row.market}`, row.version && `판 ${row.version}`, row.description].filter(Boolean).join(' · ');
    return row.description || '설명 없음';
  };

  function rowHtml({ id, icon, name, sub, agents, off = [], right, err, state }) {
    return `<div class="st-opt tl-row${off.length && off.length === agents.length ? ' off' : ''}${state ? ` ${state}` : ''}"${id ? ` data-id="${esc(id)}"` : ''}>${icon}`
      + `<span class="st-opt-text">${esc(name)}<small>${sub}</small>${err ? `<small class="tl-err">${esc(err)}</small>` : ''}</span>`
      + `<span class="tl-ag">${agents.map(chip).join('')}${off.length ? '<span class="tl-off">꺼짐</span>' : ''}</span>${right}</div>`;
  }
  const btn = (act, id, label, { danger } = {}) => `<button type="button" class="tl-btn${danger ? ' danger' : ''}" data-act="${act}" data-id="${esc(id)}"${busy || acting ? ' disabled' : ''}>${label}</button>`;
  const spinner = (txt) => `<span class="tl-busy"><span class="tl-spin"></span>${esc(txt)}</span>`;
  const badge = (txt, cls = '') => `<span class="tl-badge ${cls}">${txt}</span>`;

  // ── 내 MCP 추가 칸(P18) — 한 번만 만들고 목록을 다시 그려도 지우지 않는다(치던 글이 날아가지 않게) ──
  let cmOpen = false, cmMode = 'paste', cmPreview = null, cmBusy = false;
  const CM_EXAMPLE = '{\n  "mcpServers": {\n    "my-files": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\자료"]\n    }\n  }\n}';
  function customHtml() {
    return `<div class="tl-cm-bar"><button type="button" class="tl-btn" data-cm-act="open">+ 내 MCP 추가</button><small>안내 페이지의 설정 글을 붙여 넣거나 직접 적어 추가합니다</small></div>
      <section class="st-grp tl-cm" id="tl-cm" hidden>
        <h3 class="tl-h"><span class="tl-t">내 MCP 추가</span><small>키(비밀번호)가 필요 없는 MCP 만 받습니다 · 새로 여는 세션부터 쓸 수 있습니다</small></h3>
        <div class="tl-cm-tabs" role="tablist"><button type="button" data-cm-mode="paste" aria-pressed="true">설정 글 붙여넣기</button><button type="button" data-cm-mode="form" aria-pressed="false">직접 적기</button></div>
        <div data-cm-pane="paste"><p class="tl-cm-help">MCP 안내 페이지에 있는 설정 글(<code>{"mcpServers": …}</code>)을 중괄호까지 통째로 붙여 넣으세요.</p>
          <textarea id="tl-cm-text" rows="8" spellcheck="false" placeholder="${esc(CM_EXAMPLE)}"></textarea></div>
        <div data-cm-pane="form" hidden>
          <label class="tl-cm-f"><span>이름</span><input id="tl-cm-name" placeholder="예: my-files (영어·숫자)" spellcheck="false" autocomplete="off"></label>
          <div class="tl-cm-f"><span>방식</span><label><input type="radio" name="tl-cm-tr" value="stdio" checked> 이 컴퓨터에서 실행</label><label><input type="radio" name="tl-cm-tr" value="http"> 인터넷 주소로 연결</label></div>
          <label class="tl-cm-f" data-cm-tr="http" hidden><span>주소</span><input id="tl-cm-url" placeholder="https://…" spellcheck="false" autocomplete="off"></label>
          <label class="tl-cm-f" data-cm-tr="stdio"><span>실행 명령</span><input id="tl-cm-cmd" placeholder="예: npx · uvx · node" spellcheck="false" autocomplete="off"></label>
          <label class="tl-cm-f" data-cm-tr="stdio"><span>인자</span><input id="tl-cm-args" placeholder="예: -y @modelcontextprotocol/server-filesystem C:\\자료" spellcheck="false" autocomplete="off"></label>
        </div>
        <div class="tl-cm-f tl-cm-ag"><span>쓰는 곳</span><label><input type="checkbox" id="tl-cm-claude" checked> Claude</label><label><input type="checkbox" id="tl-cm-codex" checked> Codex</label></div>
        <div id="tl-cm-out"></div>
        <div class="tl-cm-acts"><button type="button" class="tl-btn" data-cm-act="preview">미리 보기</button><button type="button" class="tl-btn" data-cm-act="install" disabled>추가</button><button type="button" class="tl-btn danger" data-cm-act="close">닫기</button></div>
      </section>`;
  }
  function cmPayload() {
    const agents = [['claude', '#tl-cm-claude'], ['codex', '#tl-cm-codex']].filter(([, s]) => $(s, host).checked).map(([a]) => a);
    if (cmMode === 'paste') return { text: $('#tl-cm-text', host).value, agents };
    const transport = $('input[name="tl-cm-tr"]:checked', host).value;
    return { form: { name: $('#tl-cm-name', host).value, transport, url: $('#tl-cm-url', host).value, command: $('#tl-cm-cmd', host).value, args: $('#tl-cm-args', host).value }, agents };
  }
  function renderCustom() {
    if (!host) return;
    const wrap = $('#tl-cm-wrap', host); if (!wrap) return;
    wrap.hidden = kind !== 'mcp';
    $('#tl-cm', host).hidden = !cmOpen; $('.tl-cm-bar', host).hidden = cmOpen;
    for (const b of host.querySelectorAll('[data-cm-mode]')) b.setAttribute('aria-pressed', String(b.dataset.cmMode === cmMode));
    for (const p of host.querySelectorAll('[data-cm-pane]')) p.hidden = p.dataset.cmPane !== cmMode;
    const tr = $('input[name="tl-cm-tr"]:checked', host)?.value || 'stdio';
    for (const el of host.querySelectorAll('[data-cm-tr]')) el.hidden = el.dataset.cmTr !== tr;
    const out = $('#tl-cm-out', host), p = cmPreview;
    const ag = (a) => (a === 'codex' ? 'Codex' : 'Claude');
    // 추가 중에는 새 MCP 가 아직 목록에 없으므로 진행 표시를 이 칸에 둔다
    if (cmBusy && acting) { out.innerHTML = `<p class="tl-cm-ok">${spinner(busy?.step || '추가하는 중…')}</p>`; $('[data-cm-act="install"]', host).disabled = true; $('[data-cm-act="preview"]', host).disabled = true; return; }
    out.innerHTML = !p ? '' : (p.errors || []).map(e => `<p class="tl-cm-err">${esc(e)}</p>`).join('')
      + (p.items || []).map(it => `<div class="tl-cm-item${it.errors.length ? ' bad' : ''}"><b>${esc(it.id)}</b>${it.name && normalize(it.name) !== it.id ? ` <small>(적은 이름 ${esc(it.name)})</small>` : ''}`
        + `<table class="tl-facts"><tr><th>방식</th><td>${it.transport === 'http' ? '인터넷 주소로 연결' : '이 컴퓨터에서 실행'}</td></tr>`
        + `<tr><th>${it.transport === 'http' ? '주소' : '실행'}</th><td><code>${esc(it.transport === 'http' ? it.url : it.runs || it.command)}</code></td></tr>`
        + `<tr><th>쓰는 곳</th><td>${(cmPayload().agents).map(ag).join(' · ') || '없음'}</td></tr></table>`
        + it.errors.map(e => `<p class="tl-cm-err">${esc(e)}</p>`).join('') + '</div>').join('')
      + (p.ok ? '<p class="tl-cm-ok">이대로 추가할 수 있습니다. 「추가」를 누르세요.</p>' : '');
    $('[data-cm-act="install"]', host).disabled = !p?.ok || cmBusy || !!busy || !!acting;
    $('[data-cm-act="preview"]', host).disabled = cmBusy;
  }
  const normalize = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  async function cmPost(op) {
    cmBusy = true; renderCustom();
    let r;
    try { r = await (await fetch(`/api/tools/custom/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmPayload()) })).json(); }
    catch (err) { r = { ok: false, error: err.message, errors: [err.message], items: [] }; }
    cmBusy = false; return r;
  }
  async function cmAct(a) {
    if (a === 'open') { cmOpen = true; renderCustom(); (cmMode === 'paste' ? $('#tl-cm-text', host) : $('#tl-cm-name', host)).focus(); return; }
    if (a === 'close') { cmOpen = false; cmPreview = null; renderCustom(); return; }
    if (a === 'preview') { cmPreview = await cmPost('preview'); renderCustom(); return; }
    if (a === 'install' && cmPreview?.ok) {
      const names = cmPreview.items.map(x => x.id).join(', ');
      const yes = await Dialog.confirm('', { title: '내 MCP 추가', html: `<p><b>${esc(names)}</b> 을(를) ${cmPayload().agents.map(x => (x === 'codex' ? 'Codex' : 'Claude')).join(' · ')}에 추가합니다.</p><p>새로 여는 세션부터 쓸 수 있습니다. 나중에 「빼기」로 지울 수 있습니다.</p>`, okLabel: '추가' });
      if (!yes) return;
      acting = cmPreview.items[0].id; render();
      const r = await cmPost('install');
      acting = null;
      if (r.ok) { cmOpen = false; cmPreview = null; $('#tl-cm-text', host).value = ''; for (const s of ['#tl-cm-name', '#tl-cm-url', '#tl-cm-cmd', '#tl-cm-args']) $(s, host).value = ''; }
      await load(true);
      if (!r.ok) Dialog.alert(`추가하지 못했습니다: ${r.error || '알 수 없는 오류'}`);
    }
  }

  function render() {
    if (!host) return;
    renderCustom();
    const body = $('#tl-body', host), tabs = $('#tl-kinds', host), ags = $('#tl-agents', host);
    if (!data) { body.innerHTML = '<div class="on-empty">불러오는 중…</div>'; return; }
    if (!data.ok) { body.innerHTML = '<div class="on-empty">도구 목록을 읽지 못했습니다.</div>'; return; }
    const k = K();
    tabs.innerHTML = KINDS.map(x => `<button type="button" data-kind="${x.key}" aria-pressed="${kind === x.key}">${Icons.svg(x.icon, 14)}${x.title} <b>${installedRows(x).length}</b></button>`).join('');
    const inst = installedRows(k);
    const cats = catItems(k);
    // 엄선 목록 항목: IRIS 가 한 에이전트라도 깔았으면 「설치됨」 묶음(장부 줄과 합침), 아니면 「설치할 수 있음」
    const irisIds = new Set(inst.filter(r => r.origin === 'iris' && r.catalogId).map(r => r.catalogId));
    // 장부에 있는데 설치 목록 읽기에서 빠진 것(설정 파일 모양이 달라 못 읽음 등)도 「설치됨」에 보인다 — 어느 묶음에서도 사라지지 않게(코덱스 코드 검토 2차 B9)
    for (const c of cats) {
      if (irisIds.has(c.id) || !c.state?.ledger) continue;
      const ag = c.agents.filter(a => c.state.agents?.[a] === 'installed');
      inst.push({ name: c.name, origin: 'iris', catalogId: c.id, agents: ag.length ? ag : c.agents, off: [] });
      irisIds.add(c.id);
    }
    // 내 MCP 가운데 목록 읽기에서 빠진 것(제거 대기·정리 필요 등)도 「설치됨」에 보인다
    if (k.key === 'mcp') for (const c of (data?.catalog?.custom || [])) {
      if (inst.some(r => r.customId === c.id)) continue;
      inst.push({ name: c.id, origin: 'custom', customId: c.id, kind: c.transport, program: c.program, agents: c.agents.length ? c.agents : ['claude'], off: [] });
    }
    const avail = cats.filter(c => !irisIds.has(c.id) && !Object.values(c.state?.agents || {}).includes('installed'));
    const allRows = [...inst.map(r => ({ t: 'inst', agents: r.agents, r })), ...avail.map(c => ({ t: 'cat', agents: c.agents, c }))];
    ags.innerHTML = AGENTS.map(([a, t]) => `<button type="button" data-agent="${a}" aria-pressed="${agent === a}">${t} <b>${a === 'all' ? allRows.length : allRows.filter(x => whose(x.agents) === a).length}</b></button>`).join('');
    const words = q.trim().toLowerCase();
    const match = (s) => !words || s.toLowerCase().includes(words);

    const instHtml = byAgent(inst).filter(r => match(`${r.name} ${r.dir || ''} ${line(r, k)} ${catById(r.catalogId)?.name || ''}`)).map(r => {
      const c = r.origin === 'iris' ? catById(r.catalogId) : null;
      let right = '';
      if (r.origin === 'base') right = badge('기본', 'base');
      else if (r.origin === 'manual') right = badge('직접 설치함', 'manual');
      else if (r.origin === 'custom') {
        const cu = customById(r.customId);
        if (busy?.id === r.customId || acting === r.customId) right = spinner(busy?.step || '진행 중…');
        else if (cu?.removeRequested) right = badge('제거 대기', 'manual') + btn('cancel', r.customId, '제거 취소');
        else right = badge('내가 추가', 'iris') + btn('remove', r.customId, '빼기', { danger: true });
        // 실행 파일은 감싸기 전 원래 명령(npx 등)으로 보인다 — 설정에는 cmd /c 로 들어가 있다
        return rowHtml({ id: r.customId, icon: iconOf(null, k), name: r.name, sub: esc(line({ ...r, program: cu?.program || r.program, kind: cu?.transport || r.kind }, k)) + ' · IRIS 에서 추가' + (cu?.removeRequested ? ' · 열린 세션이 모두 끝나면 지웁니다' : ''), agents: r.agents, off: r.off, right, err: cu?.error });
      }
      else if (busy?.id === r.catalogId || acting === r.catalogId) right = spinner(busy?.step || '진행 중…');
      else if (c?.state?.removeRequested) right = badge('제거 대기', 'manual') + btn('cancel', c.id, '제거 취소');
      else if (c) {
        const missing = c.agents.filter(a => c.state?.agents?.[a] === 'absent');
        right = (missing.length ? btn('install', c.id, `${missing.map(a => a === 'codex' ? 'Codex' : 'Claude').join('·')}에도 설치`) : '') + btn('remove', c.id, '제거', { danger: true });
      } else right = badge('IRIS 설치', 'iris');
      const name = c ? c.name : r.name;
      const sub = c ? `${esc(c.desc)}${c.account ? ` · <b>${esc(c.account)}</b>` : ''}${c.state?.removeRequested ? ' · 열린 세션이 모두 끝나면 지웁니다' : ''}` : esc(line(r, k));
      return rowHtml({ id: c?.id, icon: iconOf(c, k), name, sub, agents: r.agents, off: r.off, right, err: c?.state?.error });
    }).join('');

    const availHtml = byAgent(avail.map(c => ({ ...c }))).filter(c => match(`${c.name} ${c.id} ${c.desc}`)).map(c => {
      const conflict = c.agents.filter(a => c.state?.agents?.[a] === 'conflict');
      let right;
      if (busy?.id === c.id || acting === c.id) right = spinner(busy?.step || '진행 중…');
      else if (conflict.length === c.agents.length) right = badge('같은 이름이 이미 있음', 'manual');
      else right = btn('install', c.id, c.state?.error ? '다시 시도' : '설치');
      const sub = `${esc(c.desc)}${c.account ? ` · <b>${esc(c.account)}</b>` : ''}${conflict.length && conflict.length < c.agents.length ? ` · ${conflict.map(a => a === 'codex' ? 'Codex' : 'Claude').join('·')}에는 같은 이름이 따로 있어 건너뜀` : ''}`;
      return rowHtml({ id: c.id, icon: iconOf(c, k), name: c.name, sub, agents: c.agents, right, err: c.state?.error });
    }).join('');

    const empty = (t) => `<div class="upd-line st-sub auth-empty">${t}</div>`;
    body.innerHTML = `<p class="tl-kdesc">${Icons.svg(k.icon, 14)}<span>${esc(k.desc)}</span></p>`
      + `<section class="st-grp tl-card" data-sec="installed"><h3 class="tl-h"><span class="tl-t">설치됨</span><span class="auth-n">${byAgent(inst).length}개</span></h3>${instHtml || empty(words ? '찾는 이름이 없습니다' : `설치된 ${k.title} 없음`)}</section>`
      + `<section class="st-grp tl-card" data-sec="available"><h3 class="tl-h"><span class="tl-t">설치할 수 있음</span><small>IRIS 가 골라 시험한 목록 · 설치·제거는 새로 여는 세션부터 적용</small><span class="auth-n">${byAgent(avail).length}개</span></h3>${availHtml || empty(words ? '찾는 이름이 없습니다' : '지금은 더 설치할 것이 없습니다')}</section>`;
  }

  let loadSeq = 0;
  async function load(force = false) {
    if (loaded && !force) return render();
    if (!data) render();
    const my = ++loadSeq; let d;
    try { d = await (await fetch('/api/tools')).json(); } catch { d = { ok: false }; }
    if (my !== loadSeq) return; // 나중에 시작한 읽기가 이미 있으면 이 결과는 버린다(오래된 응답이 새 상태를 덮지 않게)
    // 데몬 응답의 busy 를 그대로 믿는다(null 포함) — 완료 방송을 놓쳐도 다시 열면 단추가 풀린다(코덱스 코드 검토 8)
    data = d; loaded = true; busy = data?.catalog?.busy ?? null; render();
  }

  function confirmHtml(c, op) {
    const ag = c.agents.map(a => a === 'codex' ? 'Codex' : 'Claude').join(' · ');
    if (op === 'remove') {
      return `<p><b>${esc(c.name)}</b> 을(를) IRIS 에서 지웁니다(${ag}).</p>`
        + '<p>열려 있는 세션이 있으면 그 세션이 쓰던 것을 빼앗지 않도록 「제거 대기」로 두었다가, 세션이 모두 끝나면 지웁니다. 직접 고친 것은 지우지 않습니다.</p>'
        + (c.account ? `<p class="tl-warn">${esc(c.account)}으로 준 권한은 그 서비스에서 따로 해제해야 합니다 — 여기서 지워도 서비스 쪽 로그인 권한은 남습니다.</p>` : '');
    }
    return `<p><b>${esc(c.name)}</b> — ${esc(c.desc)}</p>`
      + `<table class="tl-facts"><tr><th>쓰는 곳</th><td>${ag}</td></tr><tr><th>만든 곳</th><td>${esc(c.vendor)} · ${esc(c.license)}</td></tr>`
      + `<tr><th>필요한 것</th><td>${c.account ? esc(c.account) + ' (처음 쓸 때 연결)' : '없음'}</td></tr>`
      + (c.effects?.length ? `<tr><th>주의</th><td>${c.effects.map(esc).join('<br>')}</td></tr>` : '')
      + `<tr><th>출처</th><td>${esc(c.home)}</td></tr></table>`
      + '<p>새로 여는 세션부터 쓸 수 있습니다. 이미 열린 세션은 그대로입니다.</p>';
  }

  async function act(op, id) {
    const c = catById(id) || customById(id); if (!c || busy || acting) return;
    if (op !== 'cancel') {
      const yes = await Dialog.confirm('', { title: op === 'install' ? '도구 설치' : '도구 제거', html: confirmHtml(c, op), okLabel: op === 'install' ? '설치' : '제거', danger: op === 'remove' });
      if (!yes) return;
    }
    acting = id; render();
    let r;
    try { r = await (await fetch(`/api/tools/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })).json(); }
    catch (err) { r = { ok: false, error: err.message }; }
    acting = null;
    await load(true);
    if (!r.ok) Dialog.alert(`${op === 'install' ? '설치' : op === 'remove' ? '제거' : '제거 취소'}하지 못했습니다: ${r.error || '알 수 없는 오류'}`);
    else if (r.deferred) Dialog.alert(`열려 있는 세션이 있어 지금은 「제거 대기」로 두었습니다. 세션을 모두 닫으면(⏻ 전부 종료 포함) 그때 지웁니다. 그 전에는 「제거 취소」로 되돌릴 수 있습니다.`);
  }

  /** ws {type:'tools'} — 진행 단계 표시 · 끝나면 다시 읽기 */
  function onTools(m) {
    busy = m.busy || null;
    if (m.changed && host && !acting) load(true); else render();
  }

  /** 설정 서랍이 「도구」 묶음을 보일 때 부른다. 열 때마다 다시 읽는다(설치·제거가 바로 보이게). */
  function show() {
    if (!host) {
      host = $('#st-tools'); if (!host) return;
      host.innerHTML = `<div class="tl-kinds" id="tl-kinds" role="tablist" aria-label="도구 종류"></div>
        <div class="tl-agents" id="tl-agents" role="group" aria-label="어느 에이전트의 도구"></div>
        <div class="on-bar"><label class="on-search">${Icons.svg('search', 14)}<input id="tl-q" type="search" placeholder="도구 이름·설명 찾기" spellcheck="false" autocomplete="off"></label></div>
        <div id="tl-cm-wrap" hidden>${customHtml()}</div>
        <div id="tl-body"></div>`;
      // 내 MCP 칸: 글을 바꾸면 미리 보기를 무효로(본 것과 다른 것을 추가하지 않게), 키 입력은 바깥 단축키(Esc 등)로 새지 않게
      const cm = $('#tl-cm-wrap', host);
      cm.addEventListener('input', () => { if (cmPreview) { cmPreview = null; renderCustom(); } });
      cm.addEventListener('change', () => { cmPreview = null; renderCustom(); });
      cm.addEventListener('keydown', (e) => { if (e.target.matches('input, textarea')) e.stopPropagation(); });
      // 아이콘 파일이 없거나 깨지면 종류 기본 선 아이콘으로 바꾼다(빈 네모·깨진 그림 안 보이게). error 는 거품이 없어 잡기 단계에서 받는다.
      host.addEventListener('error', (e) => {
        const img = e.target; if (!(img instanceof HTMLImageElement) || !img.classList.contains('tl-ic')) return;
        const s = document.createElement('span'); s.className = 'tl-ic tl-ic-k'; s.innerHTML = Icons.svg(K().icon, 22); img.replaceWith(s);
      }, true);
      const input = $('#tl-q', host);
      input.addEventListener('input', () => { q = input.value; render(); });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { input.value = ''; q = ''; render(); } });
      host.addEventListener('click', (e) => {
        const t = e.target.closest('[data-kind]'); if (t && t.closest('#tl-kinds')) { kind = t.dataset.kind; try { localStorage.setItem(KEY_TAB, kind); } catch {} return render(); }
        const a = e.target.closest('[data-agent]'); if (a) { agent = a.dataset.agent; return render(); }
        const m = e.target.closest('[data-cm-mode]'); if (m) { cmMode = m.dataset.cmMode; cmPreview = null; return renderCustom(); }
        const ca = e.target.closest('[data-cm-act]'); if (ca && !ca.disabled) return cmAct(ca.dataset.cmAct);
        const b = e.target.closest('[data-act]'); if (b && !b.disabled) act(b.dataset.act, b.dataset.id);
      });
    }
    load(true);
  }
  return { show, onTools };
})();

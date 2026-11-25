// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 빠른 찾기(P18 2026-11-25 4차 7번): Ctrl+K — 대화 · 폴더 · 설정 · 서식 · 하는 일을 한 칸에서. 첫소리(ㅅㅈ → 설정)로도 찾는다. 이 화면에 있는 것만 찾고 밖으로 나가지 않는다. */
window.Palette = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const cho = (s) => [...s].map((c) => { const n = c.charCodeAt(0) - 0xac00; return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c; }).join('');
  const KIND = { act: '하는 일', chat: '대화', folder: '폴더', set: '설정', tpl: '서식' };
  // 설정 낱말 → 묶음(settings.js PANES). 새 설정이 생기면 여기에 낱말을 더한다.
  const SET = [['디자인', 'design', '모양 테마 색 글자 크기 별 애니메이션 무대 인트로 수학'], ['알림', 'notify', '완료 소리 윈도 알림'], ['세션 기본값', 'session', '권한 승인 샌드박스 이어 열기'], ['예약 실행', 'sched', '시간 매일 자동'], ['온톨로지', 'ontology', '역할 영역 프로젝트 구조 관계 지도'], ['도구', 'tools', 'MCP 스킬 플러그인 추가 열쇠'], ['확장 모듈', 'mods', '메신저 설치'], ['계정', 'account', '로그인 구독 공유 사람 수 인증 열쇠 잠금'], ['개인정보·기록', 'privacy', '가리기 앞 판 기록 폴더 권한'], ['새 PC로 옮기기', 'move', '묶음 이사 백업'], ['업데이트·정보', 'about', '새 판 버전 설명서 튜토리얼']];
  let box = null, opts = {}, all = [], shown = [], k = 0, prev = null;
  const isOpen = () => !!box && !box.hidden;

  async function gather() {
    const acts = (opts.actions?.() || []).filter((a) => a.when?.() !== false).map((a) => ({ kind: 'act', name: a.name, sub: a.key || '', more: a.words || '', run: a.run }));
    const chats = (opts.sessions?.() || []).map((s) => ({ kind: 'chat', name: s.title || s.folder, sub: `${s.agent} · ${s.folder}`, more: s.folder, run: () => opts.pickSession(s.id) }));
    const sets = SET.map(([name, pane, more]) => ({ kind: 'set', name, sub: '설정', more, run: () => opts.openPane(pane) }));
    all = [...chats, ...acts, ...sets];
    const now = all;
    const [f, t] = await Promise.all([fetch('/api/folders').then((r) => r.json()).catch(() => null), fetch('/api/templates').then((r) => r.json()).catch(() => null)]);
    if (all !== now) return;
    all = [...all, ...(t?.list || []).map((x, i) => ({ kind: 'tpl', name: x.name, sub: '자주 쓰는 요청', more: String(x.text).slice(0, 200), run: () => opts.openTemplate(i) })),
      ...(f?.folders || []).map((x) => ({ kind: 'folder', name: x.name, sub: x.rel, more: `${x.rel} ${(x.codes || []).join(' ')}`, run: () => opts.pickFolder(x) }))];
    if (isOpen()) draw();
  }
  function score(it, words) {
    const name = it.name.toLowerCase(), hay = `${name} ${it.more.toLowerCase()} ${it.sub.toLowerCase()}`, nc = cho(name); let s = 0;
    for (const w of words) {
      if (name.startsWith(w)) s += 8; else if (name.includes(w)) s += 5; else if (hay.includes(w)) s += 2;
      else if (/^[ㄱ-ㅎ]+$/.test(w) && nc.replace(/\s/g, '').includes(w)) s += 4; else return 0;
    }
    return s + (it.kind === 'act' || it.kind === 'set' ? 0.6 : it.kind === 'chat' ? 0.5 : 0);
  }
  function draw() {
    const words = $('.srch-in', box).value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = words.length ? all.map((it) => [score(it, words), it]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 40).map(([, it]) => it)
      : [...all.filter((x) => x.kind === 'chat').slice(0, 6), ...all.filter((x) => x.kind === 'act')];
    k = Math.min(k, Math.max(0, shown.length - 1));
    $('.srch-list', box).innerHTML = shown.length ? shown.map((it, i) => `<button type="button" role="option" class="pal-i${i === k ? ' on' : ''}" data-k="${i}" aria-selected="${i === k}"><i>${KIND[it.kind]}</i><b>${esc(it.name)}</b><small>${esc(it.sub)}</small></button>`).join('') : '<p class="srch-empty">찾은 것이 없어요. 대화 속 글을 찾으려면 Ctrl+Shift+F 를 쓰세요.</p>';
  }
  function move(d) { if (!shown.length) return; k = (k + d + shown.length) % shown.length; for (const b of box.querySelectorAll('.pal-i')) { const on = Number(b.dataset.k) === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (on) b.scrollIntoView({ block: 'nearest' }); } }
  function go(i) { const it = shown[i]; if (!it) return; close(true); it.run(); }
  function build() {
    box = document.createElement('div'); box.id = 'palette'; box.className = 'srch'; box.hidden = true;
    box.innerHTML = '<div class="srch-box" role="dialog" aria-modal="true" aria-label="빠른 찾기"><div class="srch-top"><input type="search" class="srch-in" placeholder="대화 · 폴더 · 설정 · 서식 · 하는 일" spellcheck="false" aria-label="빠른 찾기"><button type="button" class="icon-btn" data-s="close" title="닫기 (Esc)">✕</button></div><div class="srch-list" role="listbox"></div><div class="pal-foot">↑↓ 고르기 · Enter 열기 · 첫소리로도 찾기(예: ㅅㅈ)</div></div>';
    document.body.appendChild(box);
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-s="close"]')) return void close(); const b = e.target.closest('[data-k]'); if (b) go(Number(b.dataset.k)); });
    $('.srch-in', box).addEventListener('input', () => { k = 0; draw(); });
    box.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') return; // 다시 누르면 닫기(아래 한 길)
      if (!e.isComposing && e.keyCode !== 229) {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); go(k); }
      }
      if (e.key !== 'Escape') e.stopPropagation(); // Esc 는 onEscape 한 길
    });
  }
  function open() { if (!box) build(); prev = document.activeElement; k = 0; $('.srch-in', box).value = ''; gather(); box.hidden = false; draw(); $('.srch-in', box).focus(); }
  function close(quiet) { if (!isOpen()) return false; box.hidden = true; if (!quiet) (prev?.isConnected ? prev : $('#composer-text'))?.focus?.(); return true; }
  function init(o) {
    opts = o || {};
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && opts.can?.() !== false) { e.preventDefault(); isOpen() ? close() : open(); } });
  }
  return { init, open, close, isOpen, _score: score };
})();

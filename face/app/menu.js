// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 작은 접힘 메뉴(P18 2026-11-24 「메뉴도 좀 정리해줘」): .mnu > [data-mnu] 단추 + .mnu-pop. 안의 단추는 원래 id·동작 그대로 — 자리만 접는다.
   바깥 누름 · 항목 누름 · Esc(onEscape) · ↑↓ 키. 자리는 화면 밖으로 나가지 않게 고정 위치로 잡는다. */
window.Menu = (() => {
  let cur = null;
  const items = (pop) => [...pop.querySelectorAll('button, label')].filter((b) => !b.hidden && b.offsetParent !== null);
  function close() { if (!cur) return false; const { btn, pop } = cur; cur = null; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus({ preventScroll: true }); return true; }
  function open(btn, pop) {
    close(); cur = { btn, pop }; pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), up = r.bottom + pop.offsetHeight + 12 > innerHeight;
    pop.style.top = `${Math.round(up ? Math.max(8, r.top - pop.offsetHeight - 6) : r.bottom + 6)}px`; pop.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)))}px`;
    items(pop)[0]?.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-mnu]');
    if (b) { e.preventDefault(); const pop = b.parentElement.querySelector('.mnu-pop'); return cur?.pop === pop ? void close() : open(b, pop); }
    if (cur && cur.pop.contains(e.target) && e.target.closest('button')) { const { btn, pop } = cur; cur = null; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('pointerdown', (e) => { if (cur && !cur.pop.contains(e.target) && !cur.btn.contains(e.target)) { const { btn, pop } = cur; cur = null; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }, true);
  document.addEventListener('keydown', (e) => {
    if (!cur || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const l = items(cur.pop), k = l.indexOf(document.activeElement); e.preventDefault(); l[(k + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length]?.focus();
  });
  addEventListener('resize', () => { if (cur) close(); });
  return { close, isOpen: () => !!cur };
})();

// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 작은 접힘 메뉴(P18 2026-11-24 「메뉴도 좀 정리해줘」): .mnu > [data-mnu] 단추 + .mnu-pop. 안의 단추는 원래 id·동작 그대로 — 자리만 접는다.
   바깥 누름 · 항목 누름 · Esc(onEscape) · ↑↓ 키. 맨 위 층(popover)에 띄운다 — 흐림 효과가 걸린 입력창 안에서는 fixed 도 입력창 기준으로 잘렸다(실측). */
window.Menu = (() => {
  let cur = null;
  const items = (pop) => [...pop.querySelectorAll('button, label')].filter((b) => !b.hidden && b.offsetParent !== null);
  function shut() { if (!cur) return null; const { btn, pop } = cur; cur = null; try { pop.hidePopover?.(); } catch {} pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); return btn; }
  function close() { const b = shut(); b?.focus({ preventScroll: true }); return !!b; }
  function open(btn, pop) {
    close(); cur = { btn, pop }; pop.hidden = false; try { pop.popover = 'manual'; pop.showPopover(); } catch {} btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), up = r.bottom + pop.offsetHeight + 12 > innerHeight;
    pop.style.top = `${Math.round(up ? Math.max(8, r.top - pop.offsetHeight - 6) : r.bottom + 6)}px`; pop.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)))}px`;
    items(pop)[0]?.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-mnu]');
    if (b) { e.preventDefault(); const pop = b.parentElement.querySelector('.mnu-pop'); return cur?.pop === pop ? void close() : open(b, pop); }
    if (cur && cur.pop.contains(e.target) && e.target.closest('button')) shut();
  });
  document.addEventListener('pointerdown', (e) => { if (cur && !cur.pop.contains(e.target) && !cur.btn.contains(e.target)) shut(); }, true);
  addEventListener('blur', () => shut()); // 미리보기 칸(iframe)을 누르면 페이지에는 누름이 오지 않는다
  document.addEventListener('keydown', (e) => {
    if (!cur || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const l = items(cur.pop), k = l.indexOf(document.activeElement); e.preventDefault(); l[(k + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length]?.focus();
  });
  addEventListener('resize', () => { if (cur) close(); });
  return { close, isOpen: () => !!cur };
})();

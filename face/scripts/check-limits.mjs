// 머리줄 배터리 값(limits.mjs limitsFromStatus) 검사 — 네트워크·실 데몬 접촉 0.
import assert from 'node:assert/strict';
import { limitsFromStatus } from '../daemon/limits.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('PASS', name); };
const claude = { name: 'me@school', provider: 'anthropic', quota: { unified5h: 0, unified7d: 1 } };
const codex = { name: 'codex-1', provider: 'codex', quota: { unified5h: null, unified7d: null } };

t('코덱스 왕관에 클로드 이름이 와도 클로드 값을 쓰지 않는다(2026-11-21 신고)', () => {
  const v = limitsFromStatus({ currentAccounts: { anthropic: 'me@school', codex: 'me@school' }, accounts: [claude, codex] });
  assert.equal(v.codex.account, 'codex-1');
  assert.equal(v.codex.d7, null);
  assert.equal(v.codex.h5, null);
  assert.equal(v.anthropic.d7, 1);
});
t('왕관이 비면 그 공급자의 켜진 첫 계정', () => {
  const v = limitsFromStatus({ currentAccounts: { anthropic: 'me@school' }, accounts: [claude, { ...codex, name: 'off', disabled: true }, codex] });
  assert.equal(v.codex.account, 'codex-1');
});
t('코덱스 왕관이 맞으면 그 값', () => {
  const c2 = { name: 'codex-2', provider: 'codex', quota: { unified5h: 0.2, unified7d: 0.4, planType: 'plus' } };
  const v = limitsFromStatus({ currentAccounts: { codex: 'codex-2' }, accounts: [claude, codex, c2] });
  assert.deepEqual([v.codex.account, v.codex.h5, v.codex.d7, v.codex.plan], ['codex-2', 0.2, 0.4, 'plus']);
});
t('provider 칸이 없는 옛 계정 = 클로드', () => {
  const v = limitsFromStatus({ currentAccounts: { anthropic: 'old' }, accounts: [{ name: 'old', quota: { unified7d: 0.3 } }] });
  assert.equal(v.anthropic.d7, 0.3);
  assert.equal(v.codex, null);
});
t('클로드 왕관에 코덱스 이름이 와도 섞이지 않는다', () => {
  const v = limitsFromStatus({ currentAccounts: { anthropic: 'codex-1' }, accounts: [codex, claude] });
  assert.equal(v.anthropic.account, 'me@school');
});
console.log(`check-limits: ${pass} PASS`);

// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// 공유 계정 「내 몫」(P18, 2026-11-12 사용자 결정 = 계정 사용률(%) ÷ 인원, 넘으면 보내기 전 확인):
// 구독 계정 하나를 여러 PC 가 나눠 쓸 때, 계정 전체 사용률(중계기 대시보드 /api/status 의 quota — 모든 PC 가 합쳐진 값)이
// 늘어난 동안 **이 PC 의 중계기에 요청이 오가고 있었으면** 그 늘어난 만큼을 이 PC 몫으로 쌓는다(1분마다).
//   · 주간: unified7dReset 이 바뀌거나 사용률이 크게 줄면(새 주) 0 부터. 5시간: 사용률이 줄면(오래된 사용이 빠짐) 내 몫도 그 아래로.
//   · 계정(currentAccounts)이 바뀌면 기준만 새로 잡는다(다른 계정의 늘어남을 섞지 않음).
//   · 같은 시간에 다른 PC 도 쓰면 그 늘어남이 양쪽에 다 잡힌다 — 실제보다 많게 보일 수 있다(덜 쓰게 되는 쪽으로 틀림).
//   · 상태 = state\share.json(데몬을 다시 켜도 이번 주 몫이 이어진다).
import fs from 'node:fs';

const PROVIDERS = ['anthropic', 'codex'];
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class ShareMeter {
  /** fetchStatus = async () => 대시보드 /api/status JSON(또는 null) */
  constructor({ file, fetchStatus, now = () => Date.now(), log = () => {} }) {
    Object.assign(this, { file, fetchStatus, now, log });
    try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.state = {}; }
  }
  #save() { try { const t = `${this.file}.tmp`; fs.writeFileSync(t, JSON.stringify(this.state, null, 2), 'utf8'); fs.renameSync(t, this.file); } catch {} }
  /** 이 PC 중계기가 (since, now] 사이에 그 공급자로 요청을 하고 있었나 */
  static busySince(activity, provider, since) {
    const a = activity || {};
    if ((a.active || []).some((r) => r.provider === provider)) return true;
    return (a.recent || []).some((r) => r.provider === provider && (Date.parse(r.endedAt || r.startedAt || '') || 0) > since);
  }
  async sample() {
    let d; try { d = await this.fetchStatus(); } catch { d = null; }
    if (!d) return this.info();
    const now = this.now(); const cur = d.currentAccounts || {};
    for (const p of PROVIDERS) {
      const acc = (d.accounts || []).find((a) => a.name === cur[p]); if (!acc) continue;
      const q = acc.quota || {}, w = num(q.unified7d), h = num(q.unified5h), reset = q.unified7dReset || null;
      const s = this.state[p] ||= { account: acc.name, mineWeek: 0, mine5h: 0, reset, last: null };
      if (s.account !== acc.name) { Object.assign(s, { account: acc.name, mineWeek: 0, mine5h: 0, reset, last: null }); this.log(`share: ${p} 계정 바뀜 → 다시 시작`); }
      if (reset && s.reset && reset !== s.reset) { s.mineWeek = 0; s.reset = reset; this.log(`share: ${p} 새 주 → 0`); }
      s.reset ||= reset;
      if (s.last) {
        const busy = ShareMeter.busySince(d.activity, p, s.last.at);
        if (w != null && s.last.w != null) {
          const dw = w - s.last.w;
          if (dw < -0.05) s.mineWeek = 0;                 // 크게 줄었다 = 새 주(초기화 시각을 못 받은 경우)
          else if (dw > 0 && busy) s.mineWeek += dw;
          s.mineWeek = Math.min(s.mineWeek, w);
        }
        if (h != null && s.last.h != null) {
          const dh = h - s.last.h;
          if (dh > 0 && busy) s.mine5h += dh;
          s.mine5h = Math.min(s.mine5h, h);                // 5시간 창에서 오래된 사용이 빠지면 내 몫도 그 아래로
        }
      }
      s.last = { w, h, at: now };
      s.accountWeek = w; s.account5h = h;
    }
    this.#save();
    return this.info();
  }
  info() {
    const out = {};
    for (const p of PROVIDERS) { const s = this.state[p]; if (s) out[p] = { account: s.account, mineWeek: s.mineWeek, mine5h: s.mine5h, accountWeek: s.accountWeek ?? null, account5h: s.account5h ?? null, reset: s.reset || null, at: s.last?.at || null }; }
    return out;
  }
}

// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// 개인 공간(P18, 2026-11-12 사용자 요청 「같은 PC 도 가끔 나눔 — 내 대화를 잠금으로」 조각 C).
//   · 공간 = 이름 + PIN(숫자 4~8자리). PIN 은 저장하지 않고 소금 친 scrypt 지문만 state\profiles.json 에.
//   · 잠금 풀기 = 무작위 열쇠(token)를 데몬 메모리에만 — 데몬을 다시 켜거나 「잠그기」·자리 비움이면 사라진다.
//   · 틀린 PIN 5번 → 그 공간은 30초 기다림(그 뒤 다시 틀릴 때마다 두 배, 최대 10분).
//   · 한계(화면에도 적는다): IRIS 화면 안의 잠금이다. 탐색기로 기록 폴더를 직접 열면 볼 수 있다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PIN_RE = /^\d{4,8}$/;
const NAME_MAX = 20;
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');

export class Profiles {
  constructor({ file, now = () => Date.now() }) { Object.assign(this, { file, now }); this.tokens = new Map(); this.fails = new Map(); }
  #read() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
  #write(list) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = `${this.file}.tmp`; fs.writeFileSync(t, JSON.stringify(list, null, 2), 'utf8'); fs.renameSync(t, this.file); }
  /** 화면용 목록(이름만) */
  list() { return this.#read().map(({ id, name }) => ({ id, name })); }
  name(id) { return this.#read().find((p) => p.id === id)?.name || null; }
  create(name, pin) {
    const n = String(name || '').trim();
    if (!n) throw new Error('이름을 적어 주세요');
    if ([...n].length > NAME_MAX) throw new Error(`이름은 ${NAME_MAX}자까지입니다`);
    if (!PIN_RE.test(String(pin || ''))) throw new Error('PIN 은 숫자 4~8자리입니다');
    const list = this.#read();
    if (list.some((p) => p.name === n)) throw new Error('같은 이름의 공간이 이미 있습니다');
    const salt = crypto.randomBytes(16).toString('hex');
    const p = { id: crypto.randomBytes(6).toString('hex'), name: n, salt, hash: hashPin(pin, salt), createdAt: new Date(this.now()).toISOString() };
    list.push(p); this.#write(list);
    return { id: p.id, name: p.name, token: this.#issue(p.id) };
  }
  #issue(id) { const t = crypto.randomBytes(24).toString('hex'); this.tokens.set(t, { id, at: this.now() }); return t; }
  #check(id, pin) {
    const p = this.#read().find((x) => x.id === id); if (!p) throw new Error('없는 공간입니다');
    const f = this.fails.get(id) || { n: 0, until: 0, wait: 30000 };
    if (f.until > this.now()) { const e = new Error(`PIN 을 여러 번 틀렸습니다 — ${Math.ceil((f.until - this.now()) / 1000)}초 뒤 다시 하세요`); e.code = 'WAIT'; throw e; }
    const a = Buffer.from(hashPin(pin, p.salt), 'hex'), b = Buffer.from(p.hash, 'hex');
    if (!PIN_RE.test(String(pin || '')) || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      f.n += 1; if (f.n >= 5) { f.until = this.now() + f.wait; f.wait = Math.min(f.wait * 2, 600000); f.n = 0; }
      this.fails.set(id, f); throw new Error('PIN 이 맞지 않습니다');
    }
    this.fails.delete(id); return p;
  }
  unlock(id, pin) { const p = this.#check(id, pin); return { id: p.id, name: p.name, token: this.#issue(p.id) }; }
  /** 열쇠 → 공간 id(없거나 모르면 null) */
  who(token) { const t = token && this.tokens.get(String(token)); return t ? t.id : null; }
  lock(token) { this.tokens.delete(String(token || '')); }
  remove(id, pin) { this.#check(id, pin); this.#write(this.#read().filter((p) => p.id !== id)); for (const [t, v] of this.tokens) if (v.id === id) this.tokens.delete(t); }
}

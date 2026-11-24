// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// recordacl.mjs — 대화 기록 폴더를 이 윈도 계정만 보게(P18 2026-11-24 고도화 15번, 사용자 결정 = 암호화 대신).
//   C:\IRIS 는 기본 권한이 「모든 사용자 읽기」라 윈도 계정을 나눠도 기록이 보인다 → 기록 폴더에서 물려받은 권한을 끊고
//   나 · SYSTEM · 관리자만 남긴다(icacls). 내용은 그대로라 잃을 것이 없고, 되돌리기 = 물려받은 권한으로(icacls /reset).
//   한계: 관리자 계정은 볼 수 있다 · 켜면 다른 윈도 계정은 이 IRIS 를 쓸 수 없다(화면에 적음).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sys = (n) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', n);
const run = (exe, args) => spawnSync(exe, args, { windowsHide: true, timeout: 120_000, encoding: 'utf8' });
export function mySid() { const r = run(sys('whoami.exe'), ['/user', '/fo', 'csv', '/nh']); return /"(S-1-5-[0-9-]+)"/.exec(r.stdout || '')?.[1] || null; }
/** 다른 일반 사용자도 볼 수 있는 폴더인가(Everyone · 인증된 사용자 · Users) */
export function isOpenToOthers(dir) {
  const ps = `$a=(Get-Acl -LiteralPath $env:IRIS_ACL_DIR).Access|?{$_.AccessControlType -eq 'Allow'}|%{try{$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}catch{''}};($a -join ',')`;
  const r = spawnSync(sys('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 30_000, encoding: 'utf8', env: { ...process.env, IRIS_ACL_DIR: dir } });
  if (r.status !== 0) return null;
  return /(^|,)(S-1-1-0|S-1-5-11|S-1-5-32-545|S-1-5-4)(,|$)/.test(r.stdout.trim());
}
/** → { locked:true|false|null } — null = 모름 */
export function status(dirs) { const v = dirs.filter((d) => fs.existsSync(d)).map(isOpenToOthers); return { locked: v.length ? (v.some((x) => x === null) ? null : v.every((x) => x === false)) : null }; }
export function setLocked(dirs, on) {
  const sid = on ? mySid() : null; if (on && !sid) throw new Error('이 윈도 계정을 확인하지 못했어요.');
  const done = [];
  for (const d of dirs) {
    if (!fs.existsSync(d) || !path.isAbsolute(d) || /^[A-Za-z]:[\\/]?$/.test(d)) continue;
    const r = run(sys('icacls.exe'), on ? [d, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q'] : [d, '/reset', '/Q']);
    if (r.status !== 0) { for (const x of done) run(sys('icacls.exe'), on ? [x, '/reset', '/Q'] : [x, '/inheritance:r', '/Q']); throw new Error('윈도 권한을 바꾸지 못했어요(이 폴더의 주인이 아닐 수 있어요). 바꾸던 것은 되돌렸어요.'); }
    done.push(d);
    if (on) for (const s of ['S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-4']) run(sys('icacls.exe'), [d, '/remove:g', `*${s}`, '/Q']); // 물려받지 않고 직접 붙은 일반 사용자 권한도
  }
  return done.length;
}

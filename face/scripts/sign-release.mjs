// 고도화판 릴리스 서명(P18, 2026-11-20) — 운영자 전용(개인 열쇠 필요). 업데이트기(daemon/update.mjs verifySignedSha256)가
// 구조판 zip 의 .sha256 첨부를 .sha256.sig(Ed25519)로 검증한다. 공개 열쇠는 daemon/modsign.mjs OFFICIAL_PUBLIC_KEYS 에 있다.
//   열쇠 만들기:  node scripts/sign-release.mjs --gen <개인열쇠 저장 경로>   → 공개 열쇠 PEM 을 화면에 낸다(개인 열쇠는 그 파일에만)
//   서명:        node scripts/sign-release.mjs <zip.sha256> --key <개인열쇠.pem>  → <zip.sha256>.sig 를 쓰고 공식 열쇠로 다시 검증
// 개인 열쇠는 ~/.claude/secrets/ 에만 둔다 — 저장소·설치 파일·로그에 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair, signManifest, verifyManifest } from '../daemon/modsign.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

if (args.includes('--gen')) {
  const out = opt('--gen');
  if (!out) { console.error('usage: --gen <개인열쇠 저장 경로>'); process.exit(2); }
  if (fs.existsSync(out)) { console.error(`이미 있습니다(덮어쓰지 않음): ${out}`); process.exit(2); }
  const { publicPem, privatePem } = generateKeyPair();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, privatePem, { mode: 0o600 });
  fs.writeFileSync(`${out}.pub`, publicPem);
  console.log(`개인 열쇠 저장: ${out}\n공개 열쇠(modsign.mjs 에 넣을 것):\n${publicPem}`);
  process.exit(0);
}

const file = args.find((a) => !a.startsWith('--') && a !== opt('--key'));
const key = opt('--key');
if (!file || !key) { console.error('usage: node scripts/sign-release.mjs <zip.sha256> --key <개인열쇠.pem>'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
const sig = signManifest(text, fs.readFileSync(key, 'utf8'));
fs.writeFileSync(`${file}.sig`, sig + '\n');
const v = verifyManifest(text, sig);
console.log(`서명: ${file}.sig · 공식 열쇠 검증 ${v.ok ? `통과(${v.keyId})` : '실패 — modsign.mjs 에 이 열쇠의 공개 열쇠가 없습니다'}`);
process.exit(v.ok ? 0 : 1);

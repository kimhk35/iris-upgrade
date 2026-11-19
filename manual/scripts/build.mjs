// 설명서 만들기: manual.html → ① IRIS-사용설명서.pdf(A4) ② face/app/manual/(IRIS 안 보기용 복사본)
// 사용: node manual/scripts/build.mjs   (그림 다시 뽑기 = gen-art.py · capture.mjs → towebp.py)
// 만든 뒤 pdf-automation pdf_compress(image_quality 85)로 줄인다(약 24MB → 5MB) — 이 스크립트 안에는 압축기가 없다.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = path.resolve(HERE, '..'); const P18 = path.resolve(M, '..');
const PW = process.env.PLAYWRIGHT_CORE || path.resolve(P18, '..', 'P04-게임존(Game Zone)', 'node_modules', 'playwright-core');
const { chromium } = createRequire(import.meta.url)(PW);
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1248', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

// ② IRIS 안 복사본: 화면에 쓰는 파일만(원본 PNG·스크립트 제외)
const APP = path.join(P18, 'face', 'app', 'manual');
fs.rmSync(APP, { recursive: true, force: true });
for (const d of ['img', 'fonts']) fs.mkdirSync(path.join(APP, d), { recursive: true });
fs.copyFileSync(path.join(M, 'manual.html'), path.join(APP, 'manual.html'));
for (const d of ['img', 'fonts']) for (const f of fs.readdirSync(path.join(M, d))) fs.copyFileSync(path.join(M, d, f), path.join(APP, d, f));

// ① PDF
const out = path.join(M, 'IRIS-사용설명서.pdf');
const b = await chromium.launch({ executablePath: EXE });
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(M, 'manual.html')).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log('PDF', out, Math.round(fs.statSync(out).size / 1024), 'KB');
console.log('APP', APP);

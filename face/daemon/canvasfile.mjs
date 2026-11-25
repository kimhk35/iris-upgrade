// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// canvasfile.mjs — 캔버스가 파일을 「원래 모습」에 가깝게 보이게 하는 것들(P18 2026-11-25 점검에서 실제로 깨지던 것):
//   · HTML: 글자 인코딩(EUC-KR·UTF-16) · 격리된 미리보기에서 localStorage 를 쓰면 페이지가 통째로 멈추던 것 · 다시 그려도 보던 자리
//   · 글자 파일: 잘린 끝 글자까지 인코딩 맞춰 읽기      · 딸린 CSS·JS·그림이 바뀐 것도 바뀐 것으로
import fs from 'node:fs';
import path from 'node:path';
import { decodeText } from './doctext.mjs';

/** 글자 파일 앞부분. 길이에서 잘린 utf-8 끝 글자를 EUC-KR 로 잘못 보지 않게 잘린 조각은 버리고 본다. */
export function readText(file, limit) {
  const size = fs.statSync(file).size; const fd = fs.openSync(file, 'r');
  let buf = Buffer.alloc(Math.min(size, limit));
  try { buf = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)); } finally { fs.closeSync(fd); }
  const cut = size > buf.length;
  if (cut && !(buf[0] === 0xff && buf[1] === 0xfe) && !(buf[0] === 0xfe && buf[1] === 0xff)) {
    let k = buf.length; while (k > buf.length - 4 && (buf[k - 1] & 0xc0) === 0x80) k--;                 // utf-8 이어지는 바이트
    if (k > buf.length - 4 && buf[k - 1] >= 0xc0) buf = buf.subarray(0, k - 1);                          // 그 글자의 첫 바이트까지
  }
  return { text: decodeText(buf).replace(/^﻿/, ''), truncated: cut, size };
}

// 격리(sandbox, 다른 출처)된 페이지는 localStorage·sessionStorage·cookie 를 만지는 순간 오류가 나 스크립트가 멈춘다 → 그 미리보기 동안만 기억하는 대역을 준다.
// 보던 자리는 부모(캔버스)에 알려 두었다가 다시 그릴 때 주소(?y=)로 돌려받는다.
const SHIM = (y) => `<script>(()=>{const mk=()=>{const m=new Map(),api={getItem:k=>m.has(k+'')?m.get(k+''):null,setItem:(k,v)=>{m.set(k+'',v+'')},removeItem:k=>{m.delete(k+'')},clear:()=>m.clear(),key:i=>[...m.keys()][i]??null};return new Proxy({},{get:(t,k)=>k==='length'?m.size:api[k]||m.get(k),set:(t,k,v)=>(m.set(k,v+''),true),has:(t,k)=>k in api||m.has(k),deleteProperty:(t,k)=>(m.delete(k),true),ownKeys:()=>[...m.keys()],getOwnPropertyDescriptor:(t,k)=>m.has(k)?{value:m.get(k),enumerable:true,configurable:true,writable:true}:undefined})};
for(const n of['localStorage','sessionStorage'])try{window[n]}catch{try{Object.defineProperty(window,n,{value:mk(),configurable:true})}catch{}}
try{document.cookie}catch{try{Object.defineProperty(document,'cookie',{get:()=>'',set:()=>{},configurable:true})}catch{}}
if(parent!==window){let w=0;addEventListener('scroll',()=>{if(!w)w=setTimeout(()=>{w=0;parent.postMessage({type:'iris-scroll',y:Math.round(scrollY)},'*')},120)},{passive:true});const y=${y};if(y>0){let n=0;const go=()=>{scrollTo(0,y);if(Math.abs(scrollY-y)>2&&n++<12)setTimeout(go,60)};addEventListener('DOMContentLoaded',go);addEventListener('load',go)}}
document.currentScript.remove()})();</script>`;

/** 미리보기로 내줄 HTML 글. tail = 끝에 붙일 것(「고르기」 스크립트). */
export function previewHtml(buf, { y = 0, tail = '' } = {}) {
  let html = decodeText(buf).replace(/^﻿/, '');
  const top = Number.isFinite(y) && y > 0 ? Math.min(1e7, Math.round(y)) : 0;
  const m = /<head(?:\s[^>]*)?>/i.exec(html) || /<html(?:\s[^>]*)?>/i.exec(html) || /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i.exec(html);
  const at = m ? m.index + m[0].length : 0;
  html = html.slice(0, at) + SHIM(top) + html.slice(at);
  if (!tail) return html;
  const end = html.toLowerCase().lastIndexOf('</body>');
  return end < 0 ? html + tail : html.slice(0, end) + tail + html.slice(end);
}

const LINK = /(?:src|href|poster)\s*=\s*["']([^"'#?:]{1,300}?\.(?:css|m?js|json|png|jpe?g|gif|webp|svg|bmp|woff2?|ttf|mp4|webm|mp3|wav))(?:[?#][^"']*)?["']/gi;
const memo = new Map(); // HTML 경로 → { mtime, deps }
/** HTML 과 그 딸린 파일(같은 폴더 기준 상대 경로) 가운데 가장 나중에 바뀐 시각. */
export function depsMtime(file, mtime) {
  if (!/\.html?$/i.test(file)) return mtime;
  let m = memo.get(file);
  if (!m || m.mtime !== mtime) {
    let deps = [];
    try {
      if (fs.statSync(file).size < 4e6) deps = [...new Set([...decodeText(fs.readFileSync(file)).matchAll(LINK)].map((x) => { try { return path.resolve(path.dirname(file), decodeURIComponent(x[1])); } catch { return ''; } }).filter((x) => x && !x.startsWith('\\\\')))].slice(0, 40);
    } catch {}
    memo.delete(file); memo.set(file, m = { mtime, deps }); if (memo.size > 50) memo.delete(memo.keys().next().value);
  }
  let t = mtime; for (const d of m.deps) { try { t = Math.max(t, fs.statSync(d).mtimeMs); } catch {} }
  return t;
}

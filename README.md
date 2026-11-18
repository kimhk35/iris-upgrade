# IRIS 고도화판 (iris-upgrade)

**First developed by HSJ · Edited by McKay**

[IRIS](https://iris-workspace.com)는 함세준 님(HSJ)이 만든, 내 PC 안에 AI 비서 작업공간(폴더 체계 · 규칙 파일 · Claude Code · Codex)을 한 번에 설치하는 오픈소스(MIT)입니다.
이 저장소는 원작자의 허락을 받아 만든 **고도화판**입니다. 원작 저작권 표시는 그대로 두었습니다.

## 들어 있는 것

| 폴더 | 내용 |
|---|---|
| `face/` | IRIS 창 — Claude Code·Codex 세션 여러 개를 한 화면에서 다루는 데스크톱 앱(Electron + Node 데몬) |
| `installer/` | 설치 패키지 — zip 하나로 IRIS 전체를 설치하는 설치기·빌드·검사 도구 |
| `messenger/` | IRIS 메신저 모듈(종단 간 암호화) |
| `homepage/` | 홈페이지(정적 사이트) |
| `pdf-engine-mcp/` | PDF 도구(MCP 서버) |
| `skills/` | AI 가 문서를 만들 때 쓰는 스킬 — 한글·워드 진짜 수식(`latex-office-math`), 표절·인용 점검(`research-plagiarism-check`) |

## 원작에서 달라진 것

**새 기능**
- 설치 화면 새 디자인(단계 지도 · 별가루 · 20칸 빛 띠)
- 내 MCP 추가(설정 글 붙여넣기 / 칸 채우기, 키 없는 것만)
- 시작 인트로(First developed by HSJ · Edited by McKay) · 수학 무대 10종(조절 막대·수식)
- 캔버스 — 대화 오른쪽에 AI 가 만드는 파일을 실시간으로
- 구독 계정을 여럿이 나눠 쓸 때: 안내 · 이 PC 사용량 · 인원수 할당 · 개인 공간 잠금
- 대화 화면 수식(KaTeX) · 한글/워드 진짜 수식 변환 · 표절·인용 점검 스킬

**보안 · 안정성**
- IRIS 창 데몬·설치기·메신저·PDF 도구의 보안 보강(출처·Host 검사, 미리보기 격리, 초대 고유번호 16자 등)
- 학교·회사 망 대비: 윈도 프록시·신뢰 인증서 사용, 설치 검은 창 한국어 안내·60초 대기, 시간 초과 프로그램 정리, 신고 묶음 비밀값 가리기
- 업데이트 뒤 새 판이 켜지지 않으면 직전 판으로 자동 복귀
- 끝난 대화에 보내면 자동 재개, 코덱스 기록 짝짓기 경합, 한글 반쪽 깨짐, 기록 파일 크기 제한 등

## 주의

- **베타입니다.** 자동 업데이트·내려받기 주소는 아직 원작(GitHub `Feynman520`)을 가리킵니다 — 자체 배포 주소로 바꾸는 작업이 남아 있습니다.
- 설치 패키지는 코드 서명이 없어 첫 실행 때 윈도 경고가 한 번 뜹니다.
- 각 부품의 작업 규칙·검사 방법은 그 폴더의 `AGENTS.md` 에 있습니다.

## 검사 돌리기

```powershell
cd face;      npm install; npm run verify:security    # 등 verify:* 
cd installer; node --test tests/**/*.test.mjs
cd messenger; node --test
```

## 허가서

MIT — `LICENSE`(원작 © Sejun Ham + 수정 © McKay). 각 부품 폴더의 원래 `LICENSE` 도 그대로 있습니다.

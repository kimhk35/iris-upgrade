# page.src.html → ① dist/index.html(+ iris-manual.pdf, Vercel 게시용) ② 바탕화면 IRIS-고도화판-업데이트-정리.html
# 그림은 한 파일 안에 넣어(base64) 바탕화면판도 혼자 열린다. 설명서 PDF 링크만 둘이 다르다.
import base64, os, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
P18 = os.path.dirname(HERE)
src = open(os.path.join(HERE, 'page.src.html'), encoding='utf-8').read()
hero = 'data:image/webp;base64,' + base64.b64encode(open(os.path.join(HERE, 'hero.webp'), 'rb').read()).decode()
page = src.replace('{{HERO}}', hero)

dist = os.path.join(HERE, 'dist')
os.makedirs(dist, exist_ok=True)
open(os.path.join(dist, 'index.html'), 'w', encoding='utf-8').write(page.replace('{{PDF}}', 'iris-manual.pdf'))
shutil.copyfile(os.path.join(P18, 'manual', 'IRIS-사용설명서.pdf'), os.path.join(dist, 'iris-manual.pdf'))
open(os.path.join(dist, '.vercelignore'), 'w', encoding='utf-8').write('.env*\n.gitignore\n.vercel\n')

desk = os.path.join(os.path.expanduser('~'), 'Desktop', 'IRIS-고도화판-업데이트-정리.html')
open(desk, 'w', encoding='utf-8').write(page.replace('{{PDF}}', 'IRIS-사용설명서.pdf'))  # 바탕화면의 설명서 PDF 를 가리킴
print('dist', sorted(os.listdir(dist)))
print('desktop', desk)

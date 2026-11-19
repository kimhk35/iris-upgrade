# 설명서 장 표지 그림: python -I manual/scripts/gen-art.py [id ...]
# OpenAI 유료(키는 ~/.claude/secrets/.env, 2026-11-20 사용자 비용 동의). gpt-image-2 높은 화질 1536x1024.
# 원본 → manual/art-src/<id>.png, 설명서용 webp → manual/img/<id>.webp
# 이미 있는 원본은 건너뛴다(다시 그리려면 원본 파일을 지운다).
import os, sys, json, base64, urllib.request, urllib.error, concurrent.futures as cf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-src')
OUT = os.path.join(ROOT, 'img')
os.makedirs(SRC, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
KEY = next(l.split('=', 1)[1].strip().strip('"\'') for l in open(os.path.expanduser('~/.claude/secrets/.env'), encoding='utf8') if l.startswith('OPENAI_API_KEY='))

STYLE = ("Elegant 2D flat vector-style editorial illustration with soft gradients and subtle grain, clean confident shapes, "
         "palette of deep midnight navy, soft indigo, warm gold accents and a little soft teal and coral, gentle starlight glow, calm and friendly mood. "
         "Characters are friendly adult Korean teachers with simple rounded features. The AI helpers are drawn as small friendly glowing star-shaped spirits "
         "(one warm orange, one cool blue-white, one violet-teal), never robots, no brand logos. "
         "Original artwork, not in the style of any specific artist. Absolutely no text, no letters, no numbers, no logos, no UI text. "
         "Wide composition with generous calm empty space at the top for a title.")
SCENES = {
    'cover': "A teacher sitting at a cozy desk at night with a laptop; from the laptop screen a soft golden iris-shaped ring of light rises, "
             "and three small star-spirit helpers float around it, a big starry night window behind. Magical but calm.",
    'ch1': "One large glowing window frame floating in a starry sky that gathers three small star-spirit helpers of different colors into one place, "
           "like a cozy shared workroom; a teacher looks at it with curiosity.",
    'ch2': "A teacher opening a small parcel box on a desk; out of the box a gentle golden light with a tiny star rises and flows into a laptop, "
           "with a small progress ribbon of light. Feeling of easy installation.",
    'ch3': "A friendly bird's-eye illustrated map of a cozy control room: a list panel on the left like a bookshelf, a big conversation board in the middle, "
           "a side easel on the right, small gauges like batteries on the top shelf; a teacher points at it with a tiny pointer. Shapes only, no text.",
    'ch4': "A teacher handing a paper folder to a small orange star-spirit helper who happily takes it; speech bubbles shown as empty rounded shapes; warm cozy desk.",
    'ch5': "An open wooden toolbox full of glowing tools (magnifying glass, microphone, small monitor, pin, scissors) floating gently above a desk, star sparkles.",
    'ch6': "A gift box bursting open with new things floating out: a small easel canvas, an elegant math formula shape made of abstract curves and symbols without letters, "
           "a violet-teal third star-spirit helper, a small plug connector. Celebration feeling.",
    'ch7': "A painter's palette with many soft round color swatches arranged like a crescent moon in a night sky, a golden ring of light, little stars; decorating theme.",
    'ch8': "Three teachers sitting around a round table sharing one big glowing lantern shaped like a battery that is divided into fair slices of light; friendly cooperation.",
    'ch9': "A calm teacher holding an umbrella under a light rain of tiny question-mark-like shapes (abstract curls, no text) while a small star-spirit helper repairs "
           "a glowing cable with a tiny wrench; reassuring mood.",
    'keys': "Several soft rounded keyboard keys floating in a starry sky like stepping stones, glowing gently, with no letters on them; a tiny star-spirit hopping across.",
    'end': "A wide calm night landscape with a hill and a small school building; above, the stars form a constellation in the shape of an iris eye ring; "
           "a teacher and three star-spirit helpers watch it together from the hill.",
}
JOBS = {k: dict(prompt=f'{STYLE} Scene: {v}', w=1600) for k, v in SCENES.items()}


def gen(jid):
    j, src = JOBS[jid], os.path.join(SRC, f'{jid}.png')
    if not os.path.exists(src):
        body = {'model': 'gpt-image-2', 'prompt': j['prompt'], 'size': '1536x1024', 'quality': 'high', 'n': 1}
        req = urllib.request.Request('https://api.openai.com/v1/images/generations', data=json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
        try:
            data = json.load(urllib.request.urlopen(req, timeout=600))
        except urllib.error.HTTPError as e:
            return f'{jid}: HTTP {e.code} {e.read()[:300]!r}'
        except Exception as e:
            return f'{jid}: {type(e).__name__} {e}'
        open(src, 'wb').write(base64.b64decode(data['data'][0]['b64_json']))
    im = Image.open(src).convert('RGB')
    w = j['w']
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, f'{jid}.webp'), 'WEBP', quality=88, method=6)
    return f'{jid}: ok {im.size}'


ids = sys.argv[1:] or list(JOBS)
with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(gen, ids))
bad = [r for r in res if ': ok' not in r]
print(f'{len(res) - len(bad)}/{len(res)} ok')
print('\n'.join(bad))

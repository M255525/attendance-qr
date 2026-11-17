# 產生 PWA 圖示：鐵灰打卡鐘＋紅色 LCD 數字＋插進去的米色出勤卡（卡上有 QR 小格）
import os
from PIL import Image, ImageDraw
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(out, exist_ok=True)

def draw(size, pad):
    s = 4 * size
    im = Image.new('RGB', (s, s), '#CFC9BC')
    d = ImageDraw.Draw(im)
    x0, x1 = pad * s, (1 - pad) * s
    w = x1 - x0
    bx0, by0, bx1, by1 = x0 + w * .1, x0 + w * .08, x1 - w * .1, x1 - w * .2
    d.rounded_rectangle([bx0, by0 + w * .03, bx1, by1 + w * .03], radius=w * .08, fill='#1B232A')
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=w * .08, fill='#2B3640')
    lx0, ly0, lx1, ly1 = bx0 + w * .1, by0 + w * .1, bx1 - w * .1, by0 + w * .32
    d.rounded_rectangle([lx0, ly0, lx1, ly1], radius=w * .03, fill='#120808')
    sw, sh = (lx1 - lx0 - w * .08) / 4, ly1 - ly0 - w * .06
    for i in range(4):
        cx = lx0 + w * .04 + i * sw + sw * .15
        d.rectangle([cx, ly0 + w * .03, cx + sw * .7, ly0 + w * .03 + w * .02], fill='#FF4D3A')
        d.rectangle([cx, ly0 + w * .03 + sh - w * .02, cx + sw * .7, ly0 + w * .03 + sh], fill='#FF4D3A')
        d.rectangle([cx + sw * .55, ly0 + w * .03, cx + sw * .7, ly0 + w * .03 + sh], fill='#FF4D3A')
        d.rectangle([cx, ly0 + w * .03, cx + sw * .15, ly0 + w * .03 + sh], fill='#FF4D3A')
    d.rectangle([bx0 + w * .16, by1 - w * .14, bx1 - w * .16, by1 - w * .1], fill='#0E1418')
    cx0, cy0, cx1, cy1 = bx0 + w * .2, by1 - w * .36, bx1 - w * .2, x1 - w * .02
    d.rectangle([cx0, cy0, cx1, cy1], fill='#F5EEDB')
    for k in range(4):
        y = cy0 + w * (.06 + k * .055)
        d.line([cx0 + w * .03, y, cx0 + w * .26, y], fill='#C9BB93', width=max(2, int(w * .008)))
    q, g = cx1 - w * .24, w * .2 / 5
    for (i, j) in ((0, 0), (1, 0), (0, 1), (2, 1), (3, 0), (4, 1), (1, 2), (3, 2), (0, 3), (2, 3), (4, 3), (1, 4), (3, 4), (4, 4)):
        d.rectangle([q + i * g, cy0 + w * .04 + j * g, q + (i + 1) * g - 1, cy0 + w * .04 + (j + 1) * g - 1], fill='#25221C')
    return im.resize((size, size), Image.LANCZOS)

draw(192, .04).save(os.path.join(out, 'icon-192.png'))
draw(512, .04).save(os.path.join(out, 'icon-512.png'))
draw(512, .16).save(os.path.join(out, 'icon-maskable-512.png'))
print('ok')

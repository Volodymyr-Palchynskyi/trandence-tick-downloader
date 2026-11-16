"""Microsoft Store listing artwork (Partner Center → Store listings → Store logos).

    python store/make-store-art.py

Writes PNGs next to this script:

    poster-art-1440x2160.png    9:16 Poster art (also 720x1080)
    box-art-2160x2160.png       1:1 Box art (also 1080x1080)
    app-tile-300x300.png        1:1 App tile icon
    app-tile-150x150.png        Store display image 150x150
    app-tile-71x71.png          Store display image 71x71

Brand purple (#7C5CFC) and the white Trandence logo, as in the app icon and the
installer artwork (assets/make-banners.py). Needs Pillow; fonts are Windows'
Segoe UI.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MARK = Image.open(ROOT / 'assets' / 'logo-mark.png').convert('RGBA')  # white logo, transparent
ICON = Image.open(ROOT / 'src-tauri' / 'icons' / 'icon.png').convert('RGBA')  # purple rounded tile

PURPLE = (124, 92, 252)
PURPLE_DEEP = (76, 48, 204)
WHITE = (255, 255, 255)
SOFT = (226, 219, 255)
FONTS = Path('C:/Windows/Fonts')


def font(bold: bool, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / ('segoeuib.ttf' if bold else 'segoeui.ttf')), px)


def gradient(w: int, h: int) -> Image.Image:
    """Brand purple deepening towards the bottom; computed small, then scaled."""
    sw, sh = 64, max(2, round(64 * h / w))
    img = Image.new('RGB', (sw, sh))
    px = img.load()
    for y in range(sh):
        for x in range(sw):
            t = (x / (sw - 1)) * 0.3 + (y / (sh - 1)) * 0.7
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(PURPLE, PURPLE_DEEP))
    return img.resize((w, h), Image.BICUBIC).convert('RGBA')


def centered(d: ImageDraw.ImageDraw, w: int, y: int, text: str, f: ImageFont.FreeTypeFont, fill) -> None:
    left, _, right, _ = d.textbbox((0, 0), text, font=f)
    d.text(((w - (right - left)) / 2 - left, y), text, font=f, fill=fill)


def mark(img: Image.Image, size: int, x: int, y: int) -> None:
    m = MARK.resize((size, size), Image.LANCZOS)
    img.alpha_composite(m, (x, y))


def save(img: Image.Image, name: str, *also: tuple[int, int]) -> None:
    img.convert('RGB').save(HERE / name)
    print(name, img.size)
    for size in also:
        alt = f'{name.rsplit("-", 1)[0]}-{size[0]}x{size[1]}.png'
        img.resize(size, Image.LANCZOS).convert('RGB').save(HERE / alt)
        print(alt, size)


# 9:16 Poster art — logo, name and what it does.
w, h = 1440, 2160
img = gradient(w, h)
d = ImageDraw.Draw(img)
mark(img, 560, (w - 560) // 2, 520)
centered(d, w, 1200, 'Trandence', font(True, 150), WHITE)
centered(d, w, 1380, 'Tick Downloader', font(False, 104), SOFT)
centered(d, w, 1820, 'Databento MBP-10 tick data', font(False, 56), SOFT)
centered(d, w, 1895, 'with your own API key', font(False, 56), SOFT)
save(img, 'poster-art-1440x2160.png', (720, 1080))

# 1:1 Box art — the logo large, the name under it.
w = h = 2160
img = gradient(w, h)
d = ImageDraw.Draw(img)
mark(img, 900, (w - 900) // 2, 440)
centered(d, w, 1460, 'Trandence', font(True, 190), WHITE)
centered(d, w, 1690, 'Tick Downloader', font(False, 130), SOFT)
save(img, 'box-art-2160x2160.png', (1080, 1080))

# App tile icons — the app icon itself.
for size in (300, 150, 71):
    ICON.resize((size, size), Image.LANCZOS).save(HERE / f'app-tile-{size}x{size}.png')
    print(f'app-tile-{size}x{size}.png', (size, size))

"""Installer artwork for Windows, in the brand purple.

    python assets/make-banners.py

Writes 24-bit BMPs to src-tauri/installer/ (referenced from tauri.conf.json):

    nsis-sidebar.bmp  164x314  .exe welcome and finish pages, left side
    nsis-header.bmp   150x57   .exe inner pages, right of the title
    wix-dialog.bmp    493x312  .msi welcome and finish pages; MSI writes its
                               text on the right, so that part stays white
    wix-banner.bmp    493x58   .msi inner pages; MSI writes the title on the
                               left, so that part stays white

assets/logo-mark.png is assets/logo-mark.svg rendered at 512 px
(npx tauri icon assets/logo-mark.svg -o <dir> --png 512). Needs Pillow; fonts
are Windows' Segoe UI.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src-tauri' / 'installer'
MARK = Image.open(ROOT / 'assets' / 'logo-mark.png').convert('RGBA')

PURPLE = (124, 92, 252)  # #7C5CFC, the web app's accent
PURPLE_DEEP = (82, 54, 214)
WHITE = (255, 255, 255)
SOFT = (230, 224, 255)
LINE = (226, 222, 240)
SS = 4  # draw at 4x, then downscale: smooth edges at these tiny sizes

FONT_DIR = Path('C:/Windows/Fonts')


def font(bold: bool, px: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / ('segoeuib.ttf' if bold else 'segoeui.ttf')), round(px * SS))


def gradient(w: int, h: int) -> Image.Image:
    """Brand purple, deepening towards the bottom right. Computed small, then scaled."""
    sw, sh = max(w // SS, 2), max(h // SS, 2)
    img = Image.new('RGB', (sw, sh))
    px = img.load()
    for y in range(sh):
        for x in range(sw):
            t = (x / (sw - 1)) * 0.35 + (y / (sh - 1)) * 0.65
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(PURPLE, PURPLE_DEEP))
    return img.resize((w, h), Image.BILINEAR)


def paste_mark(img: Image.Image, size: float, x: float, y: float) -> None:
    mark = MARK.resize((round(size * SS), round(size * SS)), Image.LANCZOS)
    img.paste(mark, (round(x * SS), round(y * SS)), mark)


def finish(img: Image.Image, w: int, h: int, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img.resize((w, h), Image.LANCZOS).convert('RGB').save(OUT / name, 'BMP')
    print(f'{name:18} {w}x{h}')


def brand_panel(w: int, h: int) -> Image.Image:
    """Logo, name and a one-line description on purple, for the left panels."""
    img = gradient(w * SS, h * SS)
    d = ImageDraw.Draw(img)
    paste_mark(img, 56, 24, 40)
    d.text((24 * SS, 112 * SS), 'Trandence', font=font(True, 21), fill=WHITE)
    d.text((24 * SS, 140 * SS), 'Tick Downloader', font=font(False, 15), fill=SOFT)
    d.text((24 * SS, (h - 34) * SS), 'Databento MBP-10 data,', font=font(False, 9.5), fill=SOFT)
    d.text((24 * SS, (h - 21) * SS), 'with your own API key', font=font(False, 9.5), fill=SOFT)
    return img


# .exe — welcome / finish
finish(brand_panel(164, 314), 164, 314, 'nsis-sidebar.bmp')

# .exe — inner pages: a purple tag with the logo and name
w, h = 150, 57
img = gradient(w * SS, h * SS)
d = ImageDraw.Draw(img)
paste_mark(img, 26, 14, 15.5)
d.text((48 * SS, 17 * SS), 'Trandence', font=font(True, 14.5), fill=WHITE)
finish(img, w, h, 'nsis-header.bmp')

# .msi — welcome / finish: the brand panel on the left, white where MSI writes
w, h = 493, 312
img = Image.new('RGB', (w * SS, h * SS), WHITE)
img.paste(brand_panel(164, h), (0, 0))
finish(img, w, h, 'wix-dialog.bmp')

# .msi — inner pages: white for MSI's title, a logo tile on the right
w, h = 493, 58
img = Image.new('RGB', (w * SS, h * SS), WHITE)
d = ImageDraw.Draw(img)
tile, x, y = 40, w - 40 - 12, (h - 40) / 2
d.rounded_rectangle([x * SS, y * SS, (x + tile) * SS, (y + tile) * SS], radius=9 * SS, fill=PURPLE)
paste_mark(img, 26, x + 7, y + 7)
d.line([(0, (h - 1) * SS), (w * SS, (h - 1) * SS)], fill=LINE, width=SS)
finish(img, w, h, 'wix-banner.bmp')

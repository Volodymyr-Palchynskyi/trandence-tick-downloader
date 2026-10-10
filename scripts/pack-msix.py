"""Pack the release exe into an MSIX for the Microsoft Store.

    npm run tauri build -- --no-bundle
    python scripts/pack-msix.py [--out DIR]

Stages src-tauri/target/release/trandence-tick-downloader.exe with
msix/AppxManifest.xml (version from src-tauri/tauri.conf.json, as a.b.c.0) and
icons made from src-tauri/icons/icon.png, then runs makeappx from the Windows
SDK. The package is unsigned: the Store signs it. To try it locally, install it
in Developer Mode:  Add-AppxPackage -AllowUnsigned <file>.msix

Needs Pillow.
"""

import argparse
import glob
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / 'src-tauri' / 'target' / 'release' / 'trandence-tick-downloader.exe'
ICON = ROOT / 'src-tauri' / 'icons' / 'icon.png'
MANIFEST = ROOT / 'msix' / 'AppxManifest.xml'
CONF = ROOT / 'src-tauri' / 'tauri.conf.json'

# Tiles and the Store logo, plated as usual.
PLATED = {
    'StoreLogo.png': 50,
    'Square44x44Logo.png': 44,
    'Square71x71Logo.png': 71,
    'Square150x150Logo.png': 150,
}
# Unplated sizes for the taskbar, Start and title bar; without them Windows
# draws the 44 px logo small on an accent-coloured square.
UNPLATED = [16, 24, 32, 48, 256]


def makeappx() -> str:
    found = sorted(glob.glob(r'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe'))
    if not found:
        sys.exit('makeappx.exe not found — install the Windows 10/11 SDK.')
    return found[-1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'src-tauri' / 'target' / 'msix'))
    args = parser.parse_args()

    if not EXE.exists():
        sys.exit(f'{EXE} not found — run: npm run tauri build -- --no-bundle')
    version = json.loads(CONF.read_text(encoding='utf-8'))['version']
    msix_version = f'{version}.0'

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f'Trandence.Tick.Downloader_{version}_x64.msix'

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / 'package'
        assets = stage / 'Assets'
        assets.mkdir(parents=True)
        shutil.copy2(EXE, stage / EXE.name)
        (stage / 'AppxManifest.xml').write_text(
            MANIFEST.read_text(encoding='utf-8').replace('{VERSION}', msix_version), encoding='utf-8'
        )

        icon = Image.open(ICON).convert('RGBA')
        for name, size in PLATED.items():
            icon.resize((size, size), Image.LANCZOS).save(assets / name)
        for size in UNPLATED:
            icon.resize((size, size), Image.LANCZOS).save(assets / f'Square44x44Logo.targetsize-{size}_altform-unplated.png')

        subprocess.run([makeappx(), 'pack', '/o', '/d', str(stage), '/p', str(target)], check=True)

    print(f'{target}  (version {msix_version})')


if __name__ == '__main__':
    main()

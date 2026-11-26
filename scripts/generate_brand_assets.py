import argparse
import base64
import io
import os
import shutil
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

_parser = argparse.ArgumentParser(description="Generate Eonara Windows & Android brand assets.")
_parser.add_argument("--win-root", type=Path, default=Path(__file__).resolve().parent.parent)
_parser.add_argument("--android-root", type=Path, default=None)
_parser.add_argument("--review-sheet", type=Path, default=None)
_args = _parser.parse_args()

WIN_ROOT = _args.win_root.resolve()
_default_android = WIN_ROOT.parent / "LyricMotion-Android"
if not _default_android.exists() and WIN_ROOT.parent.name == ".worktrees":
    _default_android = WIN_ROOT.parent.parent.parent / "LyricMotion-Android"
AND_ROOT = (_args.android_root or Path(os.environ.get("EONARA_ANDROID_ROOT", str(_default_android)))).resolve()
REVIEW_OUT = _args.review_sheet.resolve() if _args.review_sheet else None
LOGO_SRC = WIN_ROOT / "assets" / "brand" / "logo-eonara.png"

# 1) Full-poster optimized copy for Splash / About screens (preserves complete illustration + bottom typography)
poster_im = Image.open(LOGO_SRC).convert("RGB")
poster_opt = poster_im.resize((720, 960), Image.Resampling.LANCZOS)
poster_opt.save(WIN_ROOT / "public" / "brand" / "logo-eonara.jpg", "JPEG", quality=88, optimize=True, progressive=True)

res_dir = AND_ROOT / "android" / "app" / "src" / "main" / "res"
for d in [
    res_dir / "drawable",
    res_dir / "values",
    res_dir / "mipmap-anydpi-v26",
    res_dir / "mipmap-mdpi",
    res_dir / "mipmap-hdpi",
    res_dir / "mipmap-xhdpi",
    res_dir / "mipmap-xxhdpi",
    res_dir / "mipmap-xxxhdpi",
]:
    d.mkdir(parents=True, exist_ok=True)
poster_opt.save(res_dir / "drawable" / "eonara_poster.jpg", "JPEG", quality=86, optimize=True)

# 2) Portrait-only crop (y: 10% .. 69%, below top micro-labels and above poster wordmark) for banners & NSIS sidebar
w, h = poster_im.size
portrait_crop = poster_im.crop((0, int(h * 0.10), w, int(h * 0.69)))
buf_crop = io.BytesIO()
portrait_crop.save(buf_crop, "JPEG", quality=90, optimize=True)
portrait_uri = f"data:image/jpeg;base64,{base64.b64encode(buf_crop.getvalue()).decode('ascii')}"

def make_symbol_svg(small_bold: bool = False, round_badge: bool = False) -> str:
    rx = "120" if round_badge else "54"
    ring_w = "17.5" if small_bold else "14.5"
    slash_w = "13" if small_bold else "10.5"
    slash_ko = "22" if small_bold else "19"
    orbit_f = "10.5" if small_bold else "8.5"
    orbit_b = "7.5" if small_bold else "6.5"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <defs>
    <radialGradient id="bgGlow" cx="74%" cy="22%" r="78%">
      <stop offset="0%" stop-color="#2a161c"/>
      <stop offset="48%" stop-color="#0f0f15"/>
      <stop offset="100%" stop-color="#08080b"/>
    </radialGradient>
    <linearGradient id="gold" x1="20%" y1="15%" x2="82%" y2="88%">
      <stop offset="0%" stop-color="#fae4c4"/>
      <stop offset="48%" stop-color="#e8c493"/>
      <stop offset="100%" stop-color="#b98e58"/>
    </linearGradient>
    <linearGradient id="goldBright" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff4df"/>
      <stop offset="65%" stop-color="#f0d1a4"/>
      <stop offset="100%" stop-color="#cfa670"/>
    </linearGradient>
    <radialGradient id="starSapphire" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#d8ecff" stop-opacity="0.95"/>
      <stop offset="45%" stop-color="#5d8cc7" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#5d8cc7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="{rx}" fill="url(#bgGlow)"/>
  <rect x="9" y="9" width="238" height="238" rx="{rx}" stroke="url(#gold)" stroke-opacity="0.32" stroke-width="2.4"/>
  <g transform="rotate(-27 126 134)">
    <path d="M 40 134 A 86 27 0 0 1 212 134" stroke="#b98e58" stroke-opacity="0.58" stroke-width="{orbit_b}" stroke-linecap="round"/>
  </g>
  <circle cx="122" cy="136" r="43" stroke="url(#gold)" stroke-width="{ring_w}"/>
  <path d="M 80 179 L 172 85" stroke="#09090d" stroke-width="{slash_ko}" stroke-linecap="round"/>
  <path d="M 80 179 L 172 85" stroke="url(#goldBright)" stroke-width="{slash_w}" stroke-linecap="round"/>
  <g transform="rotate(-27 126 134)">
    <path d="M 212 134 A 86 27 0 0 1 40 134" stroke="#09090d" stroke-width="16" stroke-linecap="round"/>
    <path d="M 212 134 A 86 27 0 0 1 40 134" stroke="url(#goldBright)" stroke-width="{orbit_f}" stroke-linecap="round"/>
  </g>
  <circle cx="182" cy="74" r="24" fill="url(#starSapphire)"/>
  <path d="M 182 44 C 183.8 64 191 71.5 212 74 C 191 76.5 183.8 84 182 104 C 180.2 84 173 76.5 152 74 C 173 71.5 180.2 64 182 44 Z" fill="url(#goldBright)"/>
  <circle cx="182" cy="74" r="3.4" fill="#fffaf0"/>
</svg>'''

SYMBOL_SVG = make_symbol_svg(False, False)
SYMBOL_SMALL_SVG = make_symbol_svg(True, False)
SYMBOL_ROUND_SVG = make_symbol_svg(False, True)

MARK_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <g transform="rotate(-27 15.5 16.5)">
    <path d="M 4.5 16.5 A 11 3.6 0 0 1 26.5 16.5" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.6" stroke-linecap="round"/>
  </g>
  <circle cx="15" cy="17" r="5.6" stroke="currentColor" stroke-width="2.1"/>
  <path d="M 9.6 22.5 L 21.8 10.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
  <g transform="rotate(-27 15.5 16.5)">
    <path d="M 26.5 16.5 A 11 3.6 0 0 1 4.5 16.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
  </g>
  <path d="M 23.2 5.2 C 23.6 8 24.4 8.8 27.2 9.2 C 24.4 9.6 23.6 10.4 23.2 13.2 C 22.8 10.4 22 9.6 19.2 9.2 C 22 8.8 22.8 8 23.2 5.2 Z" fill="currentColor"/>
</svg>
'''

# Refined full wordmark: symmetrical margins (x: 105..785 -> center = 445), cleaner orbit arc clearance above tagline
WORDMARK_FULL_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 890 280" fill="none">
  <defs>
    <linearGradient id="wmGold" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#f9e2c1"/>
      <stop offset="50%" stop-color="#e8c493"/>
      <stop offset="100%" stop-color="#c99f68"/>
    </linearGradient>
    <linearGradient id="wmGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#e8c493" stop-opacity="0.12"/>
      <stop offset="50%" stop-color="#f7dfb9" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#e8c493" stop-opacity="0.12"/>
    </linearGradient>
  </defs>
  <!-- Back orbit behind O-N-A-R -->
  <g transform="rotate(-11 475 110)">
    <path d="M 208 112 A 268 41 0 0 1 744 106" stroke="url(#wmGold)" stroke-opacity="0.62" stroke-width="2.4"/>
  </g>
  <!-- E -->
  <path d="M 105 64 H 176 V 73 H 119 V 104 H 164 V 113 H 119 V 146 H 178 V 155 H 105 Z" fill="url(#wmGold)"/>
  <!-- O slash -->
  <circle cx="248" cy="110" r="44" stroke="url(#wmGold)" stroke-width="11"/>
  <path d="M 200 144 L 296 76" stroke="url(#wmGold)" stroke-width="4.5" stroke-linecap="round"/>
  <!-- N + star spire -->
  <path d="M 326 155 V 64 H 338 L 408 139 V 64 H 419 V 155 H 407 L 337 80 V 155 Z" fill="url(#wmGold)"/>
  <path d="M 378 8 C 380.2 38 383.5 46 398 48 C 383.5 50 380.2 58 378 82 C 375.8 58 372.5 50 358 48 C 372.5 46 375.8 38 378 8 Z" fill="url(#wmGold)"/>
  <!-- A -->
  <path d="M 451 155 L 494 63 H 506 L 549 155 H 534 L 500 79 L 466 155 Z" fill="url(#wmGold)"/>
  <path d="M 472 122 Q 500 114 528 122" stroke="url(#wmGold)" stroke-width="6.5" stroke-linecap="round"/>
  <!-- R -->
  <path d="M 578 155 V 64 H 618 C 638 64 650 74 650 90 C 650 105 639 115 621 117 L 656 155 H 639 L 607 118 H 591 V 155 Z M 591 74 V 108 H 617 C 630 108 637 101 637 91 C 637 80 630 74 617 74 Z" fill="url(#wmGold)"/>
  <!-- Final A -->
  <path d="M 684 155 L 728 63 H 741 L 785 155 H 770 L 734.5 78 L 699 155 Z" fill="url(#wmGold)"/>
  <!-- Front orbit crossing smoothly cleanly above subtitle -->
  <g transform="rotate(-11 475 110)">
    <path d="M 744 106 A 268 41 0 0 1 208 112" stroke="#08080b" stroke-width="8.5" stroke-opacity="0.82"/>
    <path d="M 744 106 A 268 41 0 0 1 208 112" stroke="url(#wmGold)" stroke-width="3.2" stroke-linecap="round"/>
  </g>
  <!-- Wide-spaced editorial tagline well below orbit -->
  <line x1="175" y1="216" x2="250" y2="216" stroke="url(#wmGlow)" stroke-width="1.2"/>
  <text x="445" y="221" text-anchor="middle" fill="#e8c493" font-family="'Inter Variable', 'Segoe UI', sans-serif" font-size="16" font-weight="500" letter-spacing="11">THE ART OF SOUND</text>
  <line x1="640" y1="216" x2="715" y2="216" stroke="url(#wmGlow)" stroke-width="1.2"/>
  <!-- Bottom star anchor -->
  <line x1="345" y1="255" x2="429" y2="255" stroke="#e8c493" stroke-opacity="0.32" stroke-width="1"/>
  <path d="M 445 239 C 446.4 251 449 253.6 461 255 C 449 256.4 446.4 259 445 271 C 443.6 259 441 256.4 429 255 C 441 253.6 443.6 251 445 239 Z" fill="#f5dbb5"/>
  <line x1="461" y1="255" x2="545" y2="255" stroke="#e8c493" stroke-opacity="0.32" stroke-width="1"/>
</svg>
'''

WORDMARK_COMPACT_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 150" fill="none">
  <defs>
    <linearGradient id="cGold" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#f9e2c1"/>
      <stop offset="50%" stop-color="#e8c493"/>
      <stop offset="100%" stop-color="#c99f68"/>
    </linearGradient>
  </defs>
  <g transform="rotate(-11 395 75)">
    <path d="M 140 78 A 258 40 0 0 1 654 70" stroke="url(#cGold)" stroke-opacity="0.55" stroke-width="2.2"/>
  </g>
  <g transform="translate(-80, -32)">
    <path d="M 105 64 H 176 V 73 H 119 V 104 H 164 V 113 H 119 V 146 H 178 V 155 H 105 Z" fill="url(#cGold)"/>
    <circle cx="248" cy="110" r="44" stroke="url(#cGold)" stroke-width="11"/>
    <path d="M 200 144 L 296 76" stroke="url(#cGold)" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M 326 155 V 64 H 338 L 408 139 V 64 H 419 V 155 H 407 L 337 80 V 155 Z" fill="url(#cGold)"/>
    <path d="M 378 24 C 380.2 44 383.5 48 394 50 C 383.5 52 380.2 56 378 76 C 375.8 56 372.5 52 362 50 C 372.5 48 375.8 44 378 24 Z" fill="url(#cGold)"/>
    <path d="M 451 155 L 494 63 H 506 L 549 155 H 534 L 500 79 L 466 155 Z" fill="url(#cGold)"/>
    <path d="M 472 122 Q 500 114 528 122" stroke="url(#cGold)" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M 578 155 V 64 H 618 C 638 64 650 74 650 90 C 650 105 639 115 621 117 L 656 155 H 639 L 607 118 H 591 V 155 Z M 591 74 V 108 H 617 C 630 108 637 101 637 91 C 637 80 630 74 617 74 Z" fill="url(#cGold)"/>
    <path d="M 684 155 L 728 63 H 741 L 785 155 H 770 L 734.5 78 L 699 155 Z" fill="url(#cGold)"/>
  </g>
  <g transform="rotate(-11 395 75)">
    <path d="M 654 70 A 258 40 0 0 1 140 78" stroke="url(#cGold)" stroke-width="3.2" stroke-linecap="round"/>
  </g>
</svg>
'''

for p in [
    WIN_ROOT / "assets" / "brand" / "eonara-symbol.svg",
    WIN_ROOT / "public" / "brand" / "eonara-symbol.svg",
    AND_ROOT / "assets" / "brand" / "eonara-symbol.svg",
]:
    p.write_text(SYMBOL_SVG, encoding="utf-8")

for p in [
    WIN_ROOT / "assets" / "brand" / "eonara-mark.svg",
    WIN_ROOT / "public" / "brand" / "eonara-mark.svg",
    AND_ROOT / "assets" / "brand" / "eonara-mark.svg",
]:
    p.write_text(MARK_SVG, encoding="utf-8")

for p in [
    WIN_ROOT / "assets" / "brand" / "eonara-wordmark-full.svg",
    WIN_ROOT / "public" / "brand" / "eonara-wordmark-full.svg",
    AND_ROOT / "assets" / "brand" / "eonara-wordmark-full.svg",
]:
    p.write_text(WORDMARK_FULL_SVG, encoding="utf-8")

for p in [
    WIN_ROOT / "assets" / "brand" / "eonara-wordmark-compact.svg",
    WIN_ROOT / "public" / "brand" / "eonara-wordmark-compact.svg",
    AND_ROOT / "assets" / "brand" / "eonara-wordmark-compact.svg",
]:
    p.write_text(WORDMARK_COMPACT_SVG, encoding="utf-8")

def make_banner_html(width: int, height: int, subtitle_right: str, kicker: str, badges: list[str]) -> str:
    badges_html = "".join(f'<span class="pill">{b}</span>' for b in badges)
    wm_w = int(width * 0.43)
    return f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  width: {width}px; height: {height}px; overflow: hidden;
  background: #08080b; color: #f6efe4;
  font-family: "Inter Variable", "Segoe UI", sans-serif;
}}
.frame {{
  position: relative; width: 100%; height: 100%; overflow: hidden;
  background:
    radial-gradient(62% 95% at 78% 46%, rgba(159, 43, 46, 0.30) 0%, rgba(93, 140, 199, 0.14) 48%, rgba(8, 8, 11, 0) 76%),
    radial-gradient(50% 70% at 14% 20%, rgba(232, 196, 147, 0.11) 0%, transparent 70%),
    #08080b;
}}
.poster-wrap {{
  position: absolute; right: 0; top: 0; width: 48%; height: 100%;
  mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.45) 18%, #000 44%, rgba(0,0,0,0.88) 92%, rgba(0,0,0,0.4) 100%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.45) 18%, #000 44%, rgba(0,0,0,0.88) 92%, rgba(0,0,0,0.4) 100%);
}}
.poster {{ width: 100%; height: 100%; object-fit: cover; object-position: 50% 35%; filter: contrast(1.04) saturate(1.02); }}
.grain {{
  position: absolute; inset: 0; opacity: 0.10; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
}}
.hud-border {{ position: absolute; inset: 22px; border: 1px solid rgba(232, 196, 147, 0.20); pointer-events: none; }}
.hud-corner {{ position: absolute; width: 12px; height: 12px; border-color: #e8c493; border-style: solid; border-width: 0; }}
.tl {{ top: 20px; left: 20px; border-top-width: 2px; border-left-width: 2px; }}
.tr {{ top: 20px; right: 20px; border-top-width: 2px; border-right-width: 2px; }}
.bl {{ bottom: 20px; left: 20px; border-bottom-width: 2px; border-left-width: 2px; }}
.br {{ bottom: 20px; right: 20px; border-bottom-width: 2px; border-right-width: 2px; }}
.content {{ position: relative; z-index: 3; width: 64%; height: 100%; padding: 56px 68px; display: flex; flex-direction: column; justify-content: space-between; }}
.kicker {{ font-size: 12px; letter-spacing: 0.28em; text-transform: uppercase; color: rgba(232, 196, 147, 0.78); font-weight: 600; }}
.wordmark {{ width: {wm_w}px; height: auto; margin: 10px 0 8px -56px; }}
.desc {{ font-size: {19 if width >= 1500 else 17}px; line-height: 1.5; color: rgba(244, 238, 229, 0.84); max-width: 610px; font-weight: 400; }}
.bottom-row {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }}
.pill {{ font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; color: #f3d7af; border: 1px solid rgba(232, 196, 147, 0.30); background: rgba(18, 16, 20, 0.65); padding: 7px 13px; border-radius: 999px; }}
.wave {{ display: flex; align-items: center; gap: 3px; opacity: 0.7; margin-right: 10px; }}
.wave i {{ width: 2px; background: #e8c493; border-radius: 2px; display: block; }}
</style></head>
<body>
  <div class="frame">
    <div class="poster-wrap"><img class="poster" src="{portrait_uri}"></div>
    <div class="grain"></div>
    <div class="hud-border"></div>
    <div class="hud-corner tl"></div><div class="hud-corner tr"></div>
    <div class="hud-corner bl"></div><div class="hud-corner br"></div>
    <div class="content">
      <div class="kicker">{kicker}</div>
      <div>
        <div class="wordmark">{WORDMARK_FULL_SVG}</div>
        <p class="desc">{subtitle_right}</p>
      </div>
      <div class="bottom-row">
        <div class="wave"><i style="height:6px"></i><i style="height:14px"></i><i style="height:22px"></i><i style="height:11px"></i><i style="height:18px"></i><i style="height:8px"></i></div>
        {badges_html}
      </div>
    </div>
  </div>
</body></html>'''

NSIS_SIDEBAR_HTML = f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: 164px; height: 314px; overflow: hidden; background: #08080b; }}
.box {{ position: relative; width: 164px; height: 314px; background: #08080b; overflow: hidden; }}
.art {{ position: absolute; top: 0; left: 0; width: 164px; height: 228px; object-fit: cover; object-position: 54% 28%; mask-image: linear-gradient(180deg, #000 50%, transparent 100%); -webkit-mask-image: linear-gradient(180deg, #000 50%, transparent 100%); }}
.lockup {{ position: absolute; left: 6px; right: 6px; bottom: 20px; text-align: center; }}
.wm {{ width: 152px; margin: 0 auto; }}
.line {{ width: 58px; height: 1px; background: rgba(232,196,147,0.45); margin: 4px auto 0; }}
</style></head>
<body><div class="box"><img class="art" src="{portrait_uri}"><div class="lockup"><div class="wm">{WORDMARK_FULL_SVG}</div><div class="line"></div></div></div></body></html>'''

NSIS_HEADER_HTML = f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: 150px; height: 57px; overflow: hidden; background: #0a0a0d; }}
.hdr {{ width: 150px; height: 57px; display: flex; align-items: center; justify-content: center; gap: 8px; background: radial-gradient(90% 100% at 85% 20%, rgba(159,43,46,0.28), #0a0a0d 70%); border-bottom: 1px solid rgba(232,196,147,0.35); }}
.ico {{ width: 28px; height: 28px; color: #f0d1a4; }}
.wm {{ width: 96px; height: auto; }}
</style></head>
<body><div class="hdr"><div class="ico">{MARK_SVG}</div><div class="wm">{WORDMARK_COMPACT_SVG}</div></div></body></html>'''

res_xmls = {
    res_dir / "values" / "colors.xml": '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0A0A0D</color>
    <color name="eonara_obsidian">#0A0A0D</color>
    <color name="eonara_champagne_gold">#E8C493</color>
    <color name="eonara_crimson">#9F2B2E</color>
</resources>
''',
    res_dir / "values" / "strings.xml": '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Eonara</string>
    <string name="app_tagline">The Art of Sound</string>
    <string name="notification_service_label">Eonara media session access</string>
</resources>
''',
    res_dir / "drawable" / "ic_launcher_background.xml": '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="radial"
                android:centerX="82"
                android:centerY="24"
                android:gradientRadius="92"
                android:startColor="#2E161C"
                android:centerColor="#101016"
                android:endColor="#08080B" />
        </aapt:attr>
    </path>
</vector>
''',
    res_dir / "drawable" / "ic_launcher_foreground.xml": '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group android:translateX="54" android:translateY="56" android:rotation="-27" android:pivotX="0" android:pivotY="0">
        <path
            android:pathData="M -29 0 A 29 9.2 0 0 1 29 0"
            android:strokeColor="#99B98E58"
            android:strokeWidth="2.4"
            android:strokeLineCap="round" />
    </group>
    <path
        android:pathData="M 52.5,41.5 A 15,15 0 1,0 52.5,71.5 A 15,15 0 1,0 52.5,41.5 Z"
        android:strokeWidth="5.2">
        <aapt:attr name="android:strokeColor">
            <gradient
                android:type="linear"
                android:startX="38"
                android:startY="42"
                android:endX="68"
                android:endY="71"
                android:startColor="#FAE4C4"
                android:endColor="#BA8F59" />
        </aapt:attr>
    </path>
    <path
        android:pathData="M 38.5,71.5 L 69.5,39.5"
        android:strokeColor="#09090D"
        android:strokeWidth="7.4"
        android:strokeLineCap="round" />
    <path
        android:pathData="M 38.5,71.5 L 69.5,39.5"
        android:strokeColor="#F4D7AE"
        android:strokeWidth="3.8"
        android:strokeLineCap="round" />
    <group android:translateX="54" android:translateY="56" android:rotation="-27" android:pivotX="0" android:pivotY="0">
        <path
            android:pathData="M 29 0 A 29 9.2 0 0 1 -29 0"
            android:strokeColor="#09090D"
            android:strokeWidth="6.0"
            android:strokeLineCap="round" />
        <path
            android:pathData="M 29 0 A 29 9.2 0 0 1 -29 0"
            android:strokeColor="#F7DCB7"
            android:strokeWidth="3.1"
            android:strokeLineCap="round" />
    </group>
    <path
        android:pathData="M 73,26 C 73.7,32.8 76.2,35.3 83,36 C 76.2,36.7 73.7,39.2 73,46 C 72.3,39.2 69.8,36.7 63,36 C 69.8,35.3 72.3,32.8 73,26 Z"
        android:fillColor="#FFF2DC" />
</vector>
''',
    res_dir / "drawable" / "ic_launcher_monochrome.xml": '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="M 52.5,41.5 A 15,15 0 1,0 52.5,71.5 A 15,15 0 1,0 52.5,41.5 Z"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="5.2" />
    <path
        android:pathData="M 38.5,71.5 L 69.5,39.5"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="4.2"
        android:strokeLineCap="round" />
    <group android:translateX="54" android:translateY="56" android:rotation="-27" android:pivotX="0" android:pivotY="0">
        <path
            android:pathData="M 29 0 A 29 9.2 0 0 1 -29 0"
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="3.2"
            android:strokeLineCap="round" />
    </group>
    <path
        android:pathData="M 73,26 C 73.7,32.8 76.2,35.3 83,36 C 76.2,36.7 73.7,39.2 73,46 C 72.3,39.2 69.8,36.7 63,36 C 69.8,35.3 72.3,32.8 73,26 Z"
        android:fillColor="#FFFFFFFF" />
</vector>
''',
    res_dir / "mipmap-anydpi-v26" / "ic_launcher.xml": '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
''',
    res_dir / "mipmap-anydpi-v26" / "ic_launcher_round.xml": '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
''',
}
for xp, xc in res_xmls.items():
    xp.write_text(xc, encoding="utf-8")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1600, "height": 640}, device_scale_factor=1)
    page = ctx.new_page()

    def render_svg_png(svg_str: str, size: int, out_path: Path | None = None, transparent: bool = True) -> Image.Image:
        page.set_viewport_size({"width": size, "height": size})
        bg = "transparent" if transparent else "#0a0a0d"
        page.set_content(f'<html><body style="margin:0;width:{size}px;height:{size}px;background:{bg};overflow:hidden">{svg_str}</body></html>')
        buf = page.screenshot(omit_background=transparent)
        im = Image.open(io.BytesIO(buf)).convert("RGBA")
        if out_path is not None:
            im.save(out_path, "PNG", optimize=True)
        return im

    ico_images = [
        render_svg_png(SYMBOL_SMALL_SVG if sz <= 24 else SYMBOL_SVG, sz)
        for sz in [16, 24, 32, 48, 64, 128, 256]
    ]
    ico_images[-1].save(
        WIN_ROOT / "src-tauri" / "icons" / "icon.ico",
        format="ICO",
        sizes=[(sz, sz) for sz in [16, 24, 32, 48, 64, 128, 256]],
        append_images=ico_images[:-1],
    )
    render_svg_png(SYMBOL_SVG, 512, WIN_ROOT / "src-tauri" / "icons" / "icon.png")

    TRAY_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14.5" fill="#0C0C11" stroke="#E8C493" stroke-opacity="0.50" stroke-width="1"/>
      <g transform="translate(0, -0.5)">
        <g transform="rotate(-27 15.5 16.5)">
          <path d="M 4.5 16.5 A 11 3.6 0 0 1 26.5 16.5" stroke="#C9A472" stroke-opacity="0.65" stroke-width="1.8" stroke-linecap="round"/>
        </g>
        <circle cx="15" cy="17" r="5.6" stroke="#E8C493" stroke-width="2.3"/>
        <path d="M 9.6 22.5 L 21.8 10.2" stroke="#F8E2C0" stroke-width="1.9" stroke-linecap="round"/>
        <g transform="rotate(-27 15.5 16.5)">
          <path d="M 26.5 16.5 A 11 3.6 0 0 1 4.5 16.5" stroke="#F8E2C0" stroke-width="1.95" stroke-linecap="round"/>
        </g>
        <path d="M 23.2 5.0 C 23.6 7.8 24.4 8.6 27.2 9.0 C 24.4 9.4 23.6 10.2 23.2 13.0 C 22.8 10.2 22 9.4 19.2 9.0 C 22 8.6 22.8 7.8 23.2 5.0 Z" fill="#FFF3DC"/>
      </g>
    </svg>'''
    tray_im = render_svg_png(TRAY_SVG, 32, WIN_ROOT / "src-tauri" / "icons" / "tray.png")
    (WIN_ROOT / "src-tauri" / "icons" / "tray-32x32.rgba").write_bytes(tray_im.tobytes())

    for name, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        render_svg_png(SYMBOL_SVG, px, res_dir / f"mipmap-{name}" / "ic_launcher.png")
        render_svg_png(SYMBOL_ROUND_SVG, px, res_dir / f"mipmap-{name}" / "ic_launcher_round.png")

    page.set_viewport_size({"width": 1600, "height": 640})
    page.set_content(make_banner_html(
        1600, 640,
        "Synchronized kinetic typography, album-adaptive OKLab light fields, and translucent desktop lyrics built natively for Windows.",
        "EONARA  ·  WINDOWS CREATIVE MOTION SUITE",
        ["13 Kinetic Styles", "7 Spectral Fields", "WinRT GSMTC", "Transparent Overlay"]
    ))
    hero_win = WIN_ROOT / "assets" / "brand" / "eonara-hero.png"
    page.screenshot(path=str(hero_win))

    page.set_content(make_banner_html(
        1600, 640,
        "Direct-WGPU synchronized lyric experience on Android with native MediaSession tracking, offline LRCLIB caching, and shaped Instrument Serif motion.",
        "EONARA FOR ANDROID  ·  NATIVE WGPU ENGINE",
        ["Direct WGPU Vulkan", "Android MediaSession", "LRCLIB + Local Import", "Rust Portable Core"]
    ))
    hero_and = AND_ROOT / "assets" / "brand" / "eonara-hero-android.png"
    page.screenshot(path=str(hero_and))

    page.set_viewport_size({"width": 1280, "height": 640})
    page.set_content(make_banner_html(
        1280, 640,
        "Album-driven kinetic typography & atmospheric shaders — The Art of Sound.",
        "EONARA  ·  OPEN SOURCE RELEASE",
        ["Windows + Android", "MIT / Apache-2.0"]
    ))
    social_win = WIN_ROOT / "assets" / "brand" / "eonara-social-preview.png"
    page.screenshot(path=str(social_win))
    shutil.copyfile(social_win, AND_ROOT / "assets" / "brand" / "eonara-social-preview.png")

    page.set_viewport_size({"width": 164, "height": 314})
    page.set_content(NSIS_SIDEBAR_HTML)
    Image.open(io.BytesIO(page.screenshot())).convert("RGB").save(WIN_ROOT / "src-tauri" / "nsis" / "sidebar.bmp", "BMP")

    page.set_viewport_size({"width": 150, "height": 57})
    page.set_content(NSIS_HEADER_HTML)
    Image.open(io.BytesIO(page.screenshot())).convert("RGB").save(WIN_ROOT / "src-tauri" / "nsis" / "header.bmp", "BMP")

    sheet = Image.new("RGB", (1400, 960), (14, 14, 18))
    sheet.paste(Image.open(hero_win).resize((860, 344), Image.Resampling.LANCZOS), (24, 24))
    sheet.paste(Image.open(hero_and).resize((860, 344), Image.Resampling.LANCZOS), (24, 384))
    sheet.paste(Image.open(WIN_ROOT / "src-tauri" / "icons" / "icon.png").resize((240, 240), Image.Resampling.LANCZOS), (910, 24))
    sheet.paste(Image.open(WIN_ROOT / "src-tauri" / "nsis" / "sidebar.bmp"), (1180, 24))
    sheet.paste(Image.open(WIN_ROOT / "src-tauri" / "nsis" / "header.bmp"), (910, 285))
    x_off = 910
    for idx, sz in enumerate([16, 24, 32, 48, 64]):
        im = ico_images[idx].convert("RGB")
        sheet.paste(im, (x_off, 365))
        sheet.paste(im.resize((sz * 2, sz * 2), Image.Resampling.NEAREST), (x_off, 440))
        x_off += max(sz * 2 + 12, 48)
    sheet.paste(Image.open(social_win).resize((580, 290), Image.Resampling.LANCZOS), (24, 650))
    tray_prev = Image.open(WIN_ROOT / "src-tauri" / "icons" / "tray.png").convert("RGB")
    sheet.paste(tray_prev, (910, 600))
    sheet.paste(tray_prev.resize((96, 96), Image.Resampling.NEAREST), (960, 600))
    and_round = Image.open(res_dir / "mipmap-xxxhdpi" / "ic_launcher_round.png").convert("RGB")
    sheet.paste(and_round, (1120, 600))
    if REVIEW_OUT is not None:
        REVIEW_OUT.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(REVIEW_OUT, "PNG")
    browser.close()

print("Regenerated clean Eonara brand assets.")

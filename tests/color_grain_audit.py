"""Quantitative & visual color-grading, optical-grain, and reference comparison audit.

Measures RGB, luminance percentiles, OKLab chroma/hue distributions, spatial luminance zones,
highlight focal peak/spread, dark-band dropoff, perceptual OKLab deltaE vs Verci references,
and BoxBlur(2) 8-bit luma optical-grain residuals across DPR 1.0, 1.25, and 2.0.
"""
import argparse
import base64
import io
import json
import math
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

ALL_STYLES = [
    "ship",
    "fisheye",
    "visual",
    "fisheye-visual",
    "codestyle",
    "codestyle-visual",
    "branches",
    "web",
    "constellation",
    "message-thread",
    "payments",
    "map-journey",
    "notifications",
]

ALL_MODES = [
    "atmospheric",
    "liquid-glass",
    "artwork",
    "mesh",
    "zen",
    "minimal",
    "manual",
]

VERCI_STYLE_MAP = {
    "ship": ("windows-ship-wide", "00126-002394.2ms.png"),
    "fisheye": ("windows-fisheye-wide", None),
    "visual": ("windows-visual", None),
    "fisheye-visual": ("windows-fisheye-visual", None),
    "codestyle": ("windows-codestyle", None),
    "codestyle-visual": ("windows-codestyle-visual", None),
    "branches": ("windows-branches", None),
    "web": ("windows-web", None),
    "constellation": ("windows-constellation", None),
    "message-thread": ("windows-native-design", None),
}


def srgb_to_linear(arr: np.ndarray) -> np.ndarray:
    a = np.clip(arr, 0.0, 1.0)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_oklab(lin: np.ndarray) -> np.ndarray:
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l = np.cbrt(np.clip(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.0, None))
    m = np.cbrt(np.clip(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0, None))
    s = np.cbrt(np.clip(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 0.0, None))
    L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    b_ch = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return np.stack([L, a, b_ch], axis=-1)


def rgb_to_oklab_scalar(r: float, g: float, b: float) -> tuple[float, float, float]:
    lin = srgb_to_linear(np.array([r, g, b], dtype=np.float64) / 255.0)
    lab = linear_to_oklab(lin)
    return float(lab[0]), float(lab[1]), float(lab[2])


def delta_e_oklab(rgb1: list[float], rgb2: list[float]) -> float:
    l1, a1, b1 = rgb_to_oklab_scalar(*rgb1)
    l2, a2, b2 = rgb_to_oklab_scalar(*rgb2)
    return round(100.0 * math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2), 2)


def detect_foreground_mask(rgb: np.ndarray) -> np.ndarray:
    """Detect high-contrast lyric/UI ink and dilute slightly to isolate clean background."""
    arr = rgb.astype(np.float32)
    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    # Local blurred field estimates smooth background without text/glyphs
    blur = np.asarray(
        Image.fromarray(luma.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=14)),
        dtype=np.float32,
    )
    high_local = (luma - blur) > 22.0
    very_bright = luma > 185.0
    raw = (high_local | very_bright).astype(np.uint8) * 255
    dilated = np.asarray(Image.fromarray(raw).filter(ImageFilter.MaxFilter(9))) > 0
    return dilated


def grain_residual(luma: np.ndarray, mask_valid: np.ndarray) -> tuple[float, float]:
    img = Image.fromarray(np.clip(luma, 0, 255).astype(np.uint8))
    smoothed = np.asarray(img.filter(ImageFilter.BoxBlur(2)), dtype=np.float32)
    res = luma.astype(np.float32) - smoothed
    # Exclude 3px border from BoxBlur edge effects
    border = np.ones_like(mask_valid, dtype=bool)
    border[:3, :] = False
    border[-3:, :] = False
    border[:, :3] = False
    border[:, -3:] = False
    valid = mask_valid & border
    if not np.any(valid):
        return 0.0, 0.0
    vals = res[valid]
    return round(float(np.std(vals)), 3), round(float(np.percentile(np.abs(vals), 95)), 3)


def analyze_image(path: Path) -> dict:
    with Image.open(path) as im:
        rgb_img = im.convert("RGB")
        rgb = np.asarray(rgb_img, dtype=np.uint8)
    h, w, _ = rgb.shape
    arr = rgb.astype(np.float32)
    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    ink_mask = detect_foreground_mask(rgb)
    bg_valid = ~ink_mask

    # Downsample for OKLab distribution speed
    step = max(1, min(h, w) // 240)
    sub = arr[::step, ::step] / 255.0
    sub_valid = bg_valid[::step, ::step]
    lab = linear_to_oklab(srgb_to_linear(sub))
    lab_bg = lab[sub_valid] if np.any(sub_valid) else lab.reshape(-1, 3)
    chroma = np.hypot(lab_bg[:, 1], lab_bg[:, 2])
    # Weighted circular mean hue on chromatic pixels
    chrom_mask = chroma > 0.02
    if np.any(chrom_mask):
        ang = np.arctan2(lab_bg[chrom_mask, 2], lab_bg[chrom_mask, 1])
        wt = chroma[chrom_mask]
        hue_deg = round(float(np.degrees(np.arctan2(np.sum(np.sin(ang) * wt), np.sum(np.cos(ang) * wt))) % 360.0), 1)
    else:
        hue_deg = 0.0

    def zone_stats(y0f: float, y1f: float, x0f: float, x1f: float) -> dict:
        y0, y1 = int(h * y0f), int(h * y1f)
        x0, x1 = int(w * x0f), int(w * x1f)
        z_mask = bg_valid[y0:y1, x0:x1]
        z_rgb = arr[y0:y1, x0:x1]
        z_luma = luma[y0:y1, x0:x1]
        pixels = z_rgb[z_mask] if np.any(z_mask) else z_rgb.reshape(-1, 3)
        mean_rgb = [round(float(pixels[:, c].mean()), 2) for c in range(3)]
        mean_l = round(float((z_luma[z_mask] if np.any(z_mask) else z_luma).mean()), 2)
        g_std, g_p95 = grain_residual(z_luma, z_mask)
        return {"rgb": mean_rgb, "luma": mean_l, "grain_std": g_std, "grain_p95": g_p95}

    zones = {
        "upper_left": zone_stats(0.08, 0.30, 0.06, 0.28),
        "upper_right": zone_stats(0.08, 0.32, 0.68, 0.94),
        "center": zone_stats(0.35, 0.62, 0.36, 0.64),
        "lower_left": zone_stats(0.74, 0.94, 0.06, 0.30),
        "lower_right": zone_stats(0.74, 0.94, 0.68, 0.94),
    }

    # Focal highlight peak on smoothed background luma
    bg_only = np.where(bg_valid, luma, np.nan)
    med = float(np.nanmedian(bg_only)) if np.any(bg_valid) else float(np.median(luma))
    filled = np.where(bg_valid, luma, med)
    smooth_bg = np.asarray(
        Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=24)),
        dtype=np.float32,
    )
    peak_idx = np.unravel_index(int(np.argmax(smooth_bg)), smooth_bg.shape)
    peak_val = float(smooth_bg[peak_idx])
    min_val = float(np.percentile(smooth_bg, 5))
    spread = float(np.mean(smooth_bg > (min_val + 0.60 * max(1.0, peak_val - min_val))))
    upper_mean = float(np.mean(smooth_bg[int(h * 0.12): int(h * 0.50), :]))
    bottom_mean = float(np.mean(smooth_bg[int(h * 0.80):, :]))
    dark_drop = round(upper_mean / max(1.0, bottom_mean), 2)

    bg_lumas = luma[bg_valid] if np.any(bg_valid) else luma.reshape(-1)
    g_global_std, g_global_p95 = grain_residual(luma, bg_valid)
    return {
        "size_px": [w, h],
        "rgb_mean": [round(float(arr[..., c][bg_valid].mean()), 2) for c in range(3)],
        "luma_pct": {
            f"p{p}": round(float(np.percentile(bg_lumas, p)), 2) for p in (10, 25, 50, 75, 90, 99)
        },
        "oklab": {
            "L_mean": round(float(lab_bg[:, 0].mean()), 4),
            "C_p50": round(float(np.percentile(chroma, 50)), 4),
            "C_p90": round(float(np.percentile(chroma, 90)), 4),
            "hue_deg": hue_deg,
        },
        "focal_peak_xy": [round(peak_idx[1] / w, 3), round(peak_idx[0] / h, 3)],
        "focal_peak_luma": round(peak_val, 2),
        "highlight_spread": round(spread, 3),
        "upper_mean_luma": round(upper_mean, 2),
        "bottom_band_luma": round(bottom_mean, 2),
        "dark_band_ratio": dark_drop,
        "grain_global": {"std": g_global_std, "p95": g_global_p95},
        "zones": zones,
    }


def measure_verci(verci_frames_dir: Path) -> dict:
    results = {}
    for style_id, (folder_name, preferred_file) in VERCI_STYLE_MAP.items():
        d = verci_frames_dir / folder_name
        if not d.exists():
            continue
        if preferred_file and (d / preferred_file).exists():
            target = d / preferred_file
        else:
            files = sorted(d.glob("*.png"))
            if not files:
                continue
            target = files[min(2, len(files) - 1)]
        m = analyze_image(target)
        m["source_frame"] = str(target)
        results[style_id] = m
    return results


def make_contact_sheet(entries: list[tuple[str, Path]], out_path: Path, cols: int = 4, tile_w: int = 380) -> None:
    if not entries:
        return
    thumbs = []
    for label, p in entries:
        with Image.open(p) as im:
            rgb = im.convert("RGB")
            tile_h = int(round(tile_w * rgb.height / max(1, rgb.width)))
            resized = rgb.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (tile_w, tile_h + 26), (14, 17, 24))
            canvas.paste(resized, (0, 26))
            draw = ImageDraw.Draw(canvas)
            draw.text((8, 6), label[:52], fill=(236, 239, 248))
            thumbs.append(canvas)
    max_h = max(t.height for t in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w + (cols + 1) * 8, rows * max_h + (rows + 1) * 8), (8, 10, 15))
    for i, t in enumerate(thumbs):
        r, c = divmod(i, cols)
        sheet.paste(t, (8 + c * (tile_w + 8), 8 + r * (max_h + 8)))
    sheet.save(out_path)


def save_grain_crop(src: Path, out_crop: Path, zoom: int = 4) -> None:
    with Image.open(src) as im:
        rgb = im.convert("RGB")
        w, h = rgb.size
        # Upper-right lit-to-mid transition region away from center text
        cx0 = int(w * 0.68)
        cy0 = int(h * 0.14)
        edge = min(128, w - cx0, h - cy0)
        crop = rgb.crop((cx0, cy0, cx0 + edge, cy0 + edge))
        enlarged = crop.resize((edge * zoom, edge * zoom), Image.Resampling.NEAREST)
        enlarged.save(out_crop)


def make_synthetic_cover_data_url(name: str) -> str:
    """Create deterministic tonal artwork fixtures matching the chromatic/contrast profiles of test albums."""
    img = Image.new("RGB", (192, 192), "#11131b")
    draw = ImageDraw.Draw(img)
    if name == "traitor":
        # Olivia Rodrigo 'SOUR' vibe: vivid lilac-violet field + neon acid/coral edge stickers
        draw.rectangle((0, 0, 192, 192), fill="#7b5ea8")
        draw.ellipse((24, 18, 168, 172), fill="#a384cf")
        draw.rectangle((14, 130, 74, 176), fill="#e65b73")
        draw.rectangle((124, 24, 178, 68), fill="#e9c864")
        draw.ellipse((68, 60, 126, 126), fill="#2c243a")
    elif name == "the_cure":
        # Deep indigo nocturnal blue + icy electric azure glow + crisp silver highlight
        draw.rectangle((0, 0, 192, 192), fill="#0a1638")
        draw.ellipse((55, -20, 210, 135), fill="#1b4d9e")
        draw.ellipse((95, 10, 185, 95), fill="#5fa8ff")
        draw.rectangle((0, 135, 192, 192), fill="#060c22")
    elif name == "UNETHICAL":
        # Dramatic crimson/plum noir + bright hot-magenta/peach rim light
        draw.rectangle((0, 0, 192, 192), fill="#260c19")
        draw.ellipse((42, 14, 188, 160), fill="#8e1b46")
        draw.ellipse((95, 18, 178, 102), fill="#eb547d")
        draw.ellipse((116, 26, 162, 72), fill="#ffad94")
    elif name == "Reminder":
        # 'Starboy' saturated crimson neon + deep cobalt blue + golden neon cross highlight
        draw.rectangle((0, 0, 192, 192), fill="#b31222")
        draw.polygon([(0, 110), (192, 50), (192, 192), (0, 192)], fill="#0e2258")
        draw.ellipse((98, 22, 172, 96), fill="#ef2b3d")
        draw.rectangle((132, 34, 144, 88), fill="#ffd257")
        draw.rectangle((116, 48, 160, 58), fill="#ffd257")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def build_fixture_url(base_url: str, stage_only: bool = True, dpr: float = 1.0) -> str:
    parsed = urlsplit(base_url)
    assert parsed.hostname in ("127.0.0.1", "localhost"), "Use local loopback"
    query = f"fixture=six-word&dpr={dpr}"
    if stage_only:
        query += "&stageOnly=1"
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", query, ""))


def run_audit(args) -> dict:
    verci_dir = Path(args.verci_dir)
    verci_metrics = measure_verci(verci_dir) if verci_dir.exists() else {}

    out_dir = args.out
    (out_dir / "styles").mkdir(parents=True, exist_ok=True)
    (out_dir / "modes").mkdir(parents=True, exist_ok=True)
    (out_dir / "grain").mkdir(parents=True, exist_ok=True)
    (out_dir / "covers").mkdir(parents=True, exist_ok=True)
    (out_dir / "ui").mkdir(parents=True, exist_ok=True)

    origin_netloc = urlsplit(args.url).netloc
    style_metrics = {}
    mode_metrics = {}
    grain_dpr_metrics = {}
    cover_metrics = {}
    style_entries = []
    mode_entries = []
    cover_entries = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--disable-background-networking", "--no-proxy-server"],
        )

        # 1. Stage-only 13 styles + 7 modes + grain DPR sweep
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            device_scale_factor=1.0,
            service_workers="block",
        )
        context.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
        page = context.new_page()
        page.goto(build_fixture_url(args.url, stage_only=True, dpr=1.0), wait_until="domcontentloaded")
        page.wait_for_function("window.__lyricFixture !== undefined")
        page.evaluate("() => window.__lyricFixture.waitFonts()")

        for style_id in ALL_STYLES:
            patch = {"styleId": style_id, "mode": "atmospheric", "bgTimeMs": 1200, "matchArt": True}
            page.evaluate("([t, p]) => window.__lyricFixture.renderAt(t, p)", [1000, patch])
            page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
            img_path = out_dir / "styles" / f"{style_id}.png"
            page.locator(".stage").screenshot(path=img_path, animations="disabled")
            m = analyze_image(img_path)
            if style_id in verci_metrics:
                vm = verci_metrics[style_id]
                m["deltaE_vs_verci"] = {
                    "upper_left": delta_e_oklab(m["zones"]["upper_left"]["rgb"], vm["zones"]["upper_left"]["rgb"]),
                    "upper_right": delta_e_oklab(m["zones"]["upper_right"]["rgb"], vm["zones"]["upper_right"]["rgb"]),
                    "lower_right": delta_e_oklab(m["zones"]["lower_right"]["rgb"], vm["zones"]["lower_right"]["rgb"]),
                    "mean_bg": delta_e_oklab(m["rgb_mean"], vm["rgb_mean"]),
                }
            style_metrics[style_id] = m
            style_entries.append((style_id, img_path))

        for mode in ALL_MODES:
            patch = {"styleId": "ship", "mode": mode, "bgTimeMs": 1200, "matchArt": True}
            page.evaluate("([t, p]) => window.__lyricFixture.renderAt(t, p)", [1000, patch])
            page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
            img_path = out_dir / "modes" / f"{mode}.png"
            page.locator(".stage").screenshot(path=img_path, animations="disabled")
            mode_metrics[mode] = analyze_image(img_path)
            mode_entries.append((mode, img_path))

        # Temporal grain stability on ship @ 1200ms vs 1240ms
        page.evaluate("([t, p]) => window.__lyricFixture.renderAt(t, p)", [1000, {"styleId": "ship", "mode": "atmospheric", "bgTimeMs": 1200, "matchArt": True}])
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
        t0_path = out_dir / "grain" / "ship-t1200.png"
        page.locator(".stage").screenshot(path=t0_path, animations="disabled")

        page.evaluate("([t, p]) => window.__lyricFixture.renderAt(t, p)", [1000, {"styleId": "ship", "mode": "atmospheric", "bgTimeMs": 1240, "matchArt": True}])
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
        t1_path = out_dir / "grain" / "ship-t1240.png"
        page.locator(".stage").screenshot(path=t1_path, animations="disabled")

        with Image.open(t0_path) as i0, Image.open(t1_path) as i1:
            a0 = np.asarray(i0.convert("RGB"), dtype=np.float32)
            a1 = np.asarray(i1.convert("RGB"), dtype=np.float32)
            temporal_rms = round(float(np.sqrt(np.mean((a1 - a0) ** 2))), 3)

        context.close()

        # 2. DPR 1.0, 1.25, 2.0 grain measurements (with quiet UI off)
        for dpr in (1.0, 1.25, 2.0):
            dctx = browser.new_context(
                viewport={"width": 1280, "height": 800},
                device_scale_factor=dpr,
                service_workers="block",
            )
            dctx.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
            dpage = dctx.new_page()
            dpage.goto(build_fixture_url(args.url, stage_only=True, dpr=dpr), wait_until="domcontentloaded")
            dpage.wait_for_function("window.__lyricFixture !== undefined")
            dpage.evaluate("() => window.__lyricFixture.waitFonts()")
            grain_vals = (0, 12, 23, 38) if dpr == 1.0 else (0, 23)
            for grain_val in grain_vals:
                dpage.evaluate(
                    "([t, p]) => window.__lyricFixture.renderAt(t, p)",
                    [1000, {"styleId": "ship", "mode": "atmospheric", "bgTimeMs": 1200, "grain": grain_val, "matchArt": True}],
                )
                dpage.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
                gp = out_dir / "grain" / f"ship-dpr{dpr}-g{grain_val}.png"
                dpage.locator(".stage").screenshot(path=gp, animations="disabled")
                gm = analyze_image(gp)
                if dpr == 1.0 or grain_val == 23:
                    save_grain_crop(gp, out_dir / "grain" / f"crop-dpr{dpr}-g{grain_val}.png", zoom=4)
                grain_dpr_metrics[f"dpr{dpr}_g{grain_val}"] = {
                    "global_std": gm["grain_global"]["std"],
                    "global_p95": gm["grain_global"]["p95"],
                    "upper_left_std": gm["zones"]["upper_left"]["grain_std"],
                    "upper_right_std": gm["zones"]["upper_right"]["grain_std"],
                    "center_std": gm["zones"]["center"]["grain_std"],
                }
            dctx.close()

        # 3. Full UI capture (Ship @ 1280x800, 1182x741, 760x530)
        for vw, vh in ((1280, 800), (1182, 741), (760, 530)):
            uctx = browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=1.0, service_workers="block")
            uctx.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
            upage = uctx.new_page()
            upage.goto(build_fixture_url(args.url, stage_only=False, dpr=1.0), wait_until="domcontentloaded")
            upage.wait_for_function("window.__lyricFixture !== undefined")
            upage.evaluate("() => window.__lyricFixture.waitFonts()")
            upage.evaluate("([t, p]) => window.__lyricFixture.renderAt(t, p)", [1000, {"styleId": "ship", "mode": "atmospheric", "bgTimeMs": 1200, "matchArt": True}])
            upage.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
            upage.screenshot(path=out_dir / "ui" / f"ui-{vw}x{vh}.png", animations="disabled")
            uctx.close()

        # 4. Album-cover IPC fixtures (traitor, the cure, UNETHICAL, Reminder compositional profiles)
        cover_ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1.0, service_workers="block")
        cover_ctx.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
        cover_ipc = r"""
        () => {
          const cb = new Map(), ev = new Map();
          let nid = 1, rev = 1, currentArt = '';
          let track = {id:'cover', source:'fixture', title:'Cover Fixture', artist:'Test', album:'',
            positionMs:1000, durationMs:180000, playing:false, rate:1, timelineValid:true, generation:1, artworkRevision:1};
          localStorage.setItem('lyricmotion.settings.v1', JSON.stringify({autoLookup:false}));
          window.isTauri = true;
          window.__setCoverArt = (dataUrl, title) => {
            currentArt = dataUrl;
            track = {...track, title, generation: track.generation + 1, artworkRevision: track.artworkRevision + 1};
            rev++;
            for (const id of ev.get('media_changed') ?? []) cb.get(id)?.({payload:{}, id});
          };
          window.__TAURI_INTERNALS__ = {
            transformCallback: fn => { const id = nid++; cb.set(id, fn); return id; },
            unregisterCallback: id => cb.delete(id),
            invoke: async (cmd, args) => {
              if (cmd === 'plugin:event|listen') {
                const list = ev.get(args.event) ?? []; list.push(args.handler); ev.set(args.event, list);
                return args.handler;
              }
              if (cmd === 'overlay_state') return {visible:false, clickThrough:true, monitors:[]};
              if (cmd === 'native_window_visible') return true;
              if (cmd === 'media_snapshot') return {activeId:'cover', revision:rev, sessions:[track]};
              if (cmd === 'media_artwork') return {dataUrl: currentArt, hash: String(track.artworkRevision)};
              return null;
            }
          };
          window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(){}};
        }
        """
        cover_ctx.add_init_script(f"({cover_ipc})()")
        cpage = cover_ctx.new_page()
        cpage.goto(args.url, wait_until="domcontentloaded")
        cpage.evaluate("document.fonts.ready")
        cpage.get_by_role("button", name="Live", exact=True).click()
        for cover_name in ("traitor", "the_cure", "UNETHICAL", "Reminder"):
            art_url = make_synthetic_cover_data_url(cover_name)
            cpage.evaluate("([u, n]) => window.__setCoverArt(u, n)", [art_url, cover_name])
            cpage.wait_for_timeout(1200)
            env_vars = cpage.evaluate(
                """() => {
                  const s = document.documentElement.style;
                  return {
                    fg: s.getPropertyValue('--env-fg'),
                    muted: s.getPropertyValue('--env-muted'),
                    accent: s.getPropertyValue('--env-accent'),
                    glass: s.getPropertyValue('--env-glass'),
                    popover: s.getPropertyValue('--env-popover'),
                    gallery: s.getPropertyValue('--env-gallery'),
                  };
                }"""
            )
            cp = out_dir / "covers" / f"{cover_name}.png"
            cpage.screenshot(path=cp, animations="disabled")
            cm = analyze_image(cp)
            cm["env_css"] = env_vars
            cover_metrics[cover_name] = cm
            cover_entries.append((cover_name, cp))
        cover_ctx.close()
        browser.close()

    make_contact_sheet(style_entries, out_dir / "contact-styles.png", cols=4)
    make_contact_sheet(mode_entries, out_dir / "contact-modes.png", cols=4)
    make_contact_sheet(cover_entries, out_dir / "contact-covers.png", cols=2, tile_w=540)

    report = {
        "verci_reference": verci_metrics,
        "lyricmotion_styles": style_metrics,
        "lyricmotion_modes": mode_metrics,
        "grain_dpr": grain_dpr_metrics,
        "grain_temporal_rms_40ms": temporal_rms,
        "cover_fixtures": cover_metrics,
    }
    (out_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--verci-dir",
        default=r"C:\D drive\Personal Project\Lyrics\research\verci\frames",
    )
    args = parser.parse_args()
    report = run_audit(args)
    print(f"Audit complete: {args.out}")
    for style_id in ("ship", "fisheye", "visual", "codestyle", "branches", "web", "constellation", "message-thread"):
        lm = report["lyricmotion_styles"].get(style_id, {})
        de = lm.get("deltaE_vs_verci", {})
        print(
            f"  {style_id:16s} | meanRGB={lm.get('rgb_mean')} | p50/p90L={lm.get('luma_pct',{}).get('p50')}/{lm.get('luma_pct',{}).get('p90')} | C_p90={lm.get('oklab',{}).get('C_p90')} | grain={lm.get('grain_global',{}).get('std')} | dE={de}"
        )
    print("Grain DPR sweep:", json.dumps(report["grain_dpr"], indent=2))
    print("Temporal 40ms grain RMS:", report["grain_temporal_rms_40ms"])


if __name__ == "__main__":
    main()

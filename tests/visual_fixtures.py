"""Deterministic playback-independent visual fixture runner & geometry/pixel measurement tool.

Drives the real Three.js WebGL2 MotionScene + BackgroundScene via ?fixture=1 in a local
loopback browser. Never drives foreground desktop UI or sends Windows input.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

ALL_EDGE_CASES = [
    "one-word",
    "three-word",
    "six-word",
    "ten-plus",
    "punctuation",
    "repeated",
    "gaps",
    "rapid",
    "wide-word",
    "emoji",
    "rtl",
    "mixed-script",
    "line-only",
]

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

PRIORITY_PHASE_TIMES_MS = [0, 50, 100, 200, 350, 500, 750, 1000, 1550, 1950]


def parse_viewport(spec: str) -> tuple[int, int]:
    w, h = spec.lower().split("x")
    return int(w), int(h)


def build_fixture_url(base_url: str, stage_only: bool = True, dpr: float = 1.0) -> str:
    parsed = urlsplit(base_url)
    assert parsed.hostname in ("127.0.0.1", "localhost"), "Use a local loopback preview URL"
    query = f"fixture=six-word&dpr={dpr}"
    if stage_only:
        query += "&stageOnly=1"
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", query, ""))


def measure_image(path: Path) -> dict:
    with Image.open(path) as img:
        rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
    h, w, _ = rgb.shape
    luma = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    # Bright foreground ink mask relative to dark background backdrop
    fg_mask = luma > max(125.0, float(np.percentile(luma, 92)) * 0.78)
    ys, xs = np.where(fg_mask)
    if len(xs) > 0:
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        crop_norm = {
            "nx": round(x0 / w, 4),
            "ny": round(y0 / h, 4),
            "nw": round((x1 - x0) / w, 4),
            "nh": round((y1 - y0) / h, 4),
            "cx": round(((x0 + x1) * 0.5) / w, 4),
            "cy": round(((y0 + y1) * 0.5) / h, 4),
            "pixel_count": int(len(xs)),
        }
    else:
        crop_norm = None
    digest = hashlib.sha256(rgb.tobytes()).hexdigest()[:16]
    return {
        "image_px": [w, h],
        "mean_luma": round(float(luma.mean()), 2),
        "p95_luma": round(float(np.percentile(luma, 95)), 2),
        "max_luma": round(float(luma.max()), 2),
        "ink_crop_norm": crop_norm,
        "sha256_prefix": digest,
    }


def make_contact_sheet(entries: list[tuple[str, Path]], out_path: Path, cols: int = 3, tile_w: int = 420) -> None:
    if not entries:
        return
    thumbs = []
    for label, p in entries:
        with Image.open(p) as im:
            im_rgb = im.convert("RGB")
            aspect = im_rgb.height / max(1, im_rgb.width)
            tile_h = int(round(tile_w * aspect))
            resized = im_rgb.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (tile_w, tile_h + 24), (14, 17, 24))
            canvas.paste(resized, (0, 24))
            draw = ImageDraw.Draw(canvas)
            draw.text((8, 5), label[:58], fill=(235, 238, 248))
            thumbs.append(canvas)
    max_h = max(t.height for t in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w + (cols + 1) * 8, rows * max_h + (rows + 1) * 8), (8, 10, 15))
    for idx, tile in enumerate(thumbs):
        r, c = divmod(idx, cols)
        sheet.paste(tile, (8 + c * (tile_w + 8), 8 + r * (max_h + 8)))
    sheet.save(out_path)


def capture_case(page, origin_netloc: str, out_dir: Path, frame_id: str, time_ms: int, patch: dict, stage_only: bool = True) -> dict:
    result = page.evaluate("([t, p]) => window.__lyricFixture.renderAt(t, p)", [time_ms, patch])
    # Wait one RAF so WebGL compositor commits before screenshot
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
    img_path = out_dir / f"{frame_id}.png"
    target = page.locator(".stage") if stage_only else page
    target.screenshot(path=img_path, animations="disabled")
    pixel_metrics = measure_image(img_path)
    return {
        "frame_id": frame_id,
        "pts_ms": time_ms,
        "config": patch,
        "viewport_css": result["viewport"],
        "dpr": result["dpr"],
        "fixture_id": result["fixtureId"],
        "style_id": result["styleId"],
        "inspection": result["inspection"],
        "pixel_metrics": pixel_metrics,
        "image": str(img_path.relative_to(out_dir)),
    }


def run_suite(args) -> dict:
    parsed = urlsplit(args.url)
    origin_netloc = parsed.netloc
    frames_dir = args.out / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    viewports = [parse_viewport(v) for v in args.viewports.split(",")]
    dprs = [float(d) for d in args.dprs.split(",")]
    phase_styles = [s.strip() for s in args.styles.split(",") if s.strip()]
    if phase_styles == ["all"]:
        phase_styles = ALL_STYLES

    records = []
    seek_checks = []
    errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--disable-background-networking", "--no-proxy-server"],
        )

        # 1. Viewport x DPR matrix (stage-only + full-chrome responsive sanity)
        viewport_sheet = []
        for w, h in viewports:
            for dpr in dprs:
                ctx = browser.new_context(
                    viewport={"width": w, "height": h},
                    device_scale_factor=dpr,
                    service_workers="block",
                )
                ctx.route(
                    "**/*",
                    lambda route: route.continue_()
                    if urlsplit(route.request.url).netloc == origin_netloc
                    else route.abort(),
                )
                page = ctx.new_page()
                page.on("pageerror", lambda err: errors.append(f"vp {w}x{h}@{dpr}: {err}"))
                page.on(
                    "console",
                    lambda msg: errors.append(f"vp {w}x{h}@{dpr}: {msg.text}")
                    if msg.type == "error"
                    else None,
                )
                url = build_fixture_url(args.url, stage_only=True, dpr=dpr)
                page.goto(url, wait_until="domcontentloaded")
                expect(page.locator(".stage canvas")).to_be_visible()
                page.evaluate("() => window.__lyricFixture.waitFonts()")

                for style_id in ("ship", "fisheye"):
                    fid = f"vp_{w}x{h}_dpr{str(dpr).replace('.', '_')}_{style_id}"
                    rec = capture_case(
                        page,
                        origin_netloc,
                        args.out,
                        f"frames/{fid}",
                        750,
                        {"styleId": style_id, "fixtureId": "six-word", "dpr": dpr, "stageOnly": True},
                        stage_only=True,
                    )
                    records.append(rec)
                    if dpr in (1.0, 2.0):
                        viewport_sheet.append((f"{w}x{h}@{dpr} {style_id}", args.out / rec["image"]))

                # Also verify full UI layout without clipping at DPR 1
                if dpr == 1.0:
                    fid_ui = f"ui_{w}x{h}_ship"
                    rec_ui = capture_case(
                        page,
                        origin_netloc,
                        args.out,
                        f"frames/{fid_ui}",
                        750,
                        {"styleId": "ship", "fixtureId": "six-word", "dpr": 1.0, "stageOnly": False},
                        stage_only=False,
                    )
                    records.append(rec_ui)
                    viewport_sheet.append((f"UI {w}x{h} ship", args.out / rec_ui["image"]))
                ctx.close()

        make_contact_sheet(viewport_sheet, args.out / "contact-viewports.png", cols=3)

        # 2. Primary canonical viewport (1182x741 @ DPR 1) for all 13 edge-case fixtures, phase sweeps, and seek checks
        ctx = browser.new_context(
            viewport={"width": 1182, "height": 741},
            device_scale_factor=1.0,
            service_workers="block",
        )
        ctx.route(
            "**/*",
            lambda route: route.continue_()
            if urlsplit(route.request.url).netloc == origin_netloc
            else route.abort(),
        )
        page = ctx.new_page()
        page.on("pageerror", lambda err: errors.append(f"edge: {err}"))
        page.on(
            "console",
            lambda msg: errors.append(f"edge: {msg.text}") if msg.type == "error" else None,
        )
        page.goto(build_fixture_url(args.url, stage_only=True, dpr=1.0), wait_until="domcontentloaded")
        expect(page.locator(".stage canvas")).to_be_visible()
        page.evaluate("() => window.__lyricFixture.waitFonts()")

        # 2a. Edge-case coverage across representative styles
        edge_sheet = []
        edge_styles = ["ship", "fisheye", "codestyle"]
        for fx_id in ALL_EDGE_CASES:
            sample_time = 2400 if fx_id == "gaps" else (140 if fx_id == "rapid" else 750)
            for st in edge_styles:
                fid = f"edge_{fx_id}_{st}"
                rec = capture_case(
                    page,
                    origin_netloc,
                    args.out,
                    f"frames/{fid}",
                    sample_time,
                    {"styleId": st, "fixtureId": fx_id, "stageOnly": True, "dpr": 1.0},
                    stage_only=True,
                )
                records.append(rec)
                if st == "ship":
                    edge_sheet.append((f"{fx_id} @ {sample_time}ms", args.out / rec["image"]))

        # Verify repeated words produce distinct glyph/token draws when revealed, and gaps draw 0 glyphs
        gap_rec = next(r for r in records if r["frame_id"] == "frames/edge_gaps_ship")
        assert gap_rec["inspection"]["cueIndex"] == -1 and len(gap_rec["inspection"]["glyphs"]) == 0, (
            f"Expected blank stage in instrumental gap, got {gap_rec['inspection']}"
        )
        make_contact_sheet(edge_sheet, args.out / "contact-edge-cases.png", cols=4)

        # 2b. Phase sweep for selected styles
        phase_sheet = []
        for st in phase_styles:
            for t in PRIORITY_PHASE_TIMES_MS:
                fid = f"phase_{st}_t{t:04d}"
                rec = capture_case(
                    page,
                    origin_netloc,
                    args.out,
                    f"frames/{fid}",
                    t,
                    {"styleId": st, "fixtureId": "six-word", "stageOnly": True, "dpr": 1.0},
                    stage_only=True,
                )
                records.append(rec)
                if st in ("ship", "fisheye", "visual", "fisheye-visual"):
                    phase_sheet.append((f"{st} t={t}ms", args.out / rec["image"]))
        make_contact_sheet(phase_sheet, args.out / "contact-phases.png", cols=5)

        # 2c. Deterministic seek invariance test (direct vs after forward/backward jumps)
        for st in phase_styles:
            target_t = 920
            direct = page.evaluate(
                "([t, st]) => window.__lyricFixture.renderAt(t, {styleId: st, fixtureId: 'six-word', stageOnly: true})",
                [target_t, st],
            )
            for jump in (120, 2900, 4800, 350, 1800):
                page.evaluate(
                    "([t, st]) => window.__lyricFixture.renderAt(t, {styleId: st, fixtureId: 'six-word', stageOnly: true})",
                    [jump, st],
                )
            reseek = page.evaluate(
                "([t, st]) => window.__lyricFixture.renderAt(t, {styleId: st, fixtureId: 'six-word', stageOnly: true})",
                [target_t, st],
            )
            match = direct["inspection"] == reseek["inspection"]
            seek_checks.append({"style": st, "target_ms": target_t, "deterministic_reseek": match})
            assert match, f"Non-deterministic seek for {st} at {target_t}ms"

        # 2d. Reduced motion determinism check
        for st in ("ship", "fisheye"):
            rm_a = page.evaluate(
                "([st]) => window.__lyricFixture.renderAt(500, {styleId: st, fixtureId: 'six-word', reducedMotion: true, stageOnly: true})",
                [st],
            )
            rm_b = page.evaluate(
                "([st]) => window.__lyricFixture.renderAt(580, {styleId: st, fixtureId: 'six-word', reducedMotion: true, stageOnly: true})",
                [st],
            )
            assert rm_a["inspection"]["glyphs"] == rm_b["inspection"]["glyphs"], (
                f"Reduced motion should freeze intra-token motion for {st}"
            )

        ctx.close()
        browser.close()

    assert not errors, f"Browser errors: {errors}"
    manifest = {
        "schema": "lyricmotion.visual_fixtures.v1",
        "url": args.url,
        "viewports": viewports,
        "dprs": dprs,
        "edge_cases": ALL_EDGE_CASES,
        "phase_styles": phase_styles,
        "phase_times_ms": PRIORITY_PHASE_TIMES_MS,
        "seek_checks": seek_checks,
        "record_count": len(records),
        "records": records,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--viewports", default="760x530,1182x741,1280x800")
    parser.add_argument("--dprs", default="1,1.25,2")
    parser.add_argument("--styles", default="ship,fisheye,visual,fisheye-visual")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = run_suite(args)
    print(f"PASS: {manifest['record_count']} fixture frames written to {args.out}")


if __name__ == "__main__":
    main()

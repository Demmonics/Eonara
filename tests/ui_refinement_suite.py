"""Playwright visual & geometric inspection suite for the visual-identity pass:
Captures all 5 responsive viewports, DPR 1/1.25/2, all popovers (including Zen editor),
and compact/scrolled/expanded gallery views, plus asserts zero overflow or popover clipping.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect


VIEWPORTS = [
    (760, 530),
    (1024, 768),
    (1182, 741),
    (1280, 800),
    (1920, 1080),
]


def make_sheet(items: list[tuple[str, Path]], out: Path, cols: int = 2, tile_w: int = 560) -> None:
    thumbs = []
    for label, p in items:
        with Image.open(p) as im:
            rgb = im.convert("RGB")
            th = int(round(tile_w * rgb.height / rgb.width))
            canvas = Image.new("RGB", (tile_w, th + 28), (12, 15, 22))
            canvas.paste(rgb.resize((tile_w, th), Image.Resampling.LANCZOS), (0, 28))
            ImageDraw.Draw(canvas).text((10, 7), label, fill=(238, 240, 248))
            thumbs.append(canvas)
    if not thumbs:
        return
    mh = max(t.height for t in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w + (cols + 1) * 10, rows * mh + (rows + 1) * 10), (7, 9, 14))
    for i, t in enumerate(thumbs):
        r, c = divmod(i, cols)
        sheet.paste(t, (10 + c * (tile_w + 10), 10 + r * (mh + 10)))
    sheet.save(out)


def check_layout(page, width: int, height: int) -> dict:
    return page.evaluate("""([w, h]) => {
      const docOverflow = document.documentElement.scrollWidth > w;
      const top = document.querySelector('.top')?.getBoundingClientRect();
      const footer = document.querySelector('.hero-footer')?.getBoundingClientRect();
      const pages = document.querySelector('.pages')?.getBoundingClientRect();
      const tiles = Array.from(document.querySelectorAll('.tile')).map(t => t.getBoundingClientRect());
      const visibleTiles = tiles.filter(r => r.right > 4 && r.left < w - 4).length;
      return {
        docOverflow,
        topHeight: top ? Math.round(top.height) : 0,
        footerBottom: footer ? Math.round(footer.bottom) : 0,
        pagesBottom: pages ? Math.round(pages.bottom) : 0,
        tileWidth: tiles[0] ? Math.round(tiles[0].width) : 0,
        tileHeight: tiles[0] ? Math.round(tiles[0].height) : 0,
        visibleTiles,
        footerOverlapPages: !!(footer && pages && pages.top < footer.bottom - 6 && pages.left < footer.right && pages.right > footer.left),
      };
    }""", [width, height])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:1439/")
    parser.add_argument("--out", default="artifacts/refinement/pass1")
    args = parser.parse_args()

    out = Path(args.out)
    for sub in ("viewports", "panels", "gallery", "dpr"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    origin_netloc = urlsplit(args.url).netloc
    report = {"viewports": {}, "panels": {}, "dpr": {}, "errors": []}
    vp_items: list[tuple[str, Path]] = []
    panel_items: list[tuple[str, Path]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--disable-background-networking", "--no-proxy-server"],
        )

        # 1. All 5 responsive viewports
        for w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, service_workers="block")
            ctx.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
            page = ctx.new_page()
            page.on("pageerror", lambda err: report["errors"].append(str(err)))
            page.on("console", lambda msg: report["errors"].append(msg.text) if msg.type == "error" else None)
            page.goto(args.url, wait_until="domcontentloaded")
            expect(page.locator(".stage canvas")).to_be_visible()
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(450)
            page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
            fp = out / "viewports" / f"vp-{w}x{h}.png"
            page.screenshot(path=fp, animations="disabled")
            vp_items.append((f"{w}x{h}", fp))
            metrics = check_layout(page, w, h)
            assert not metrics["docOverflow"], f"Horizontal overflow at {w}x{h}"
            report["viewports"][f"{w}x{h}"] = metrics
            ctx.close()

        # 2. All popovers, Zen editor, and Gallery states at 1280x800
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
        ctx.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
        page = ctx.new_page()
        page.on("pageerror", lambda err: report["errors"].append(str(err)))
        page.on("console", lambda msg: report["errors"].append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        expect(page.locator(".stage canvas")).to_be_visible()
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(450)

        for label in ("Size", "Font", "Screen", "Aesthetics"):
            page.get_by_role("button", name=label, exact=True).click()
            popover = page.locator("#panel")
            expect(popover).to_be_visible()
            box = popover.bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= 1280, f"{label} clipped horizontally: {box}"
            assert box["y"] >= 0 and box["y"] + box["height"] <= 800, f"{label} clipped vertically: {box}"
            report["panels"][label] = {k: round(v) for k, v in box.items()}
            fp = out / "panels" / f"panel-{label.lower()}.png"
            page.screenshot(path=fp, animations="disabled")
            panel_items.append((f"Panel: {label}", fp))
            if label == "Aesthetics":
                page.get_by_label("Background", exact=True).select_option("zen")
                expect(page.get_by_role("region", name="Zen Gradient Editor")).to_be_visible()
                page.wait_for_timeout(200)
                zbox = popover.bounding_box()
                assert zbox and zbox["y"] + zbox["height"] <= 800, f"Zen editor clipped: {zbox}"
                zfp = out / "panels" / "panel-aesthetics-zen.png"
                page.screenshot(path=zfp, animations="disabled")
                panel_items.append(("Panel: Aesthetics (Zen)", zfp))
                page.get_by_label("Background", exact=True).select_option("atmospheric")
            page.keyboard.press("Escape")

        page.get_by_role("button", name="Other players diagnostics").click()
        expect(page.locator("#panel")).to_be_visible()
        dbox = page.locator("#panel").bounding_box()
        assert dbox and dbox["x"] + dbox["width"] <= 1280 and dbox["y"] + dbox["height"] <= 800
        dfp = out / "panels" / "panel-diagnostics.png"
        page.screenshot(path=dfp, animations="disabled")
        panel_items.append(("Panel: Diagnostics", dfp))
        page.keyboard.press("Escape")

        # Gallery scrolled + expanded
        page.locator('[data-action="gallery-next"]').click()
        page.wait_for_timeout(350)
        g_scroll = out / "gallery" / "gallery-scrolled.png"
        page.screenshot(path=g_scroll, animations="disabled")
        page.get_by_role("button", name="Expand", exact=True).click()
        page.wait_for_timeout(350)
        g_exp = out / "gallery" / "gallery-expanded.png"
        page.screenshot(path=g_exp, animations="disabled", full_page=True)
        ctx.close()

        # 3. DPR 1.0 / 1.25 / 2.0 captures at 1182x741 (Verci native capture window scale)
        for dpr in (1.0, 1.25, 2.0):
            dctx = browser.new_context(viewport={"width": 1182, "height": 741}, device_scale_factor=dpr, service_workers="block")
            dctx.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).netloc == origin_netloc else r.abort())
            dpage = dctx.new_page()
            dpage.goto(args.url, wait_until="domcontentloaded")
            expect(dpage.locator(".stage canvas")).to_be_visible()
            dpage.evaluate("document.fonts.ready")
            dpage.wait_for_timeout(400)
            df = out / "dpr" / f"ui-1182x741-dpr{dpr}.png"
            dpage.screenshot(path=df, animations="disabled")
            report["dpr"][str(dpr)] = check_layout(dpage, 1182, 741)
            dctx.close()

        browser.close()

    make_sheet(vp_items, out / "contact-viewports.png", cols=2, tile_w=580)
    make_sheet(panel_items, out / "contact-panels.png", cols=3, tile_w=420)
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    assert not report["errors"], f"Browser errors: {report['errors']}"
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

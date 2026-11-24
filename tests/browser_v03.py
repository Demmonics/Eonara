"""Offscreen v0.3 regression. Simulates Tauri in the isolated page only; never drives Windows input."""
import argparse
import base64
import io
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect


def fixture_art(path=None, warm=False):
    if path:
        image = Image.open(path).convert("RGB")
        image.thumbnail((512, 512))
    elif warm:
        image = Image.new("RGB", (128, 128), "#803419")
        draw = ImageDraw.Draw(image)
        draw.ellipse((-25, -38, 130, 90), fill="#e59839")
        draw.rectangle((60, 87, 128, 128), fill="#a29038")
    else:
        image = Image.new("RGB", (128, 128), "#30306b")
        draw = ImageDraw.Draw(image)
        draw.ellipse((25, -40, 145, 96), fill="#a18ade")
        draw.rectangle((0, 100, 95, 127), fill="#4c2c2f")
        draw.ellipse((8, 21, 61, 82), fill="#506ecf")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


IPC = r"""
({ artwork, nextArtwork }) => {
  const callback = new Map(), events = new Map();
  let nextId = 1, revision = 1;
  let track = {id:'fixture',source:'fixture',title:'First fixture',artist:'Controlled test',album:'',
    positionMs:92000,durationMs:229000,playing:true,rate:1,timelineValid:true,generation:1,artworkRevision:1};
  let changedAt = performance.now(), art = artwork;
  window.__artworkCalls = {};
  window.__fixtureUpdate = (fields, useNextArtwork) => {
    track = {...track,...fields}; revision++; changedAt = performance.now();
    if (useNextArtwork !== undefined) art = useNextArtwork ? nextArtwork : artwork;
    for(const id of events.get('media_changed') ?? []) callback.get(id)?.({payload:{},id});
  };
  localStorage.setItem('lyricmotion.settings.v1', JSON.stringify({autoLookup:false}));
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback:fn => {const id = nextId++; callback.set(id,fn); return id},
    unregisterCallback:id => callback.delete(id),
    invoke:async (cmd,args) => {
      if (cmd === 'plugin:event|listen') {
        const list = events.get(args.event) ?? []; list.push(args.handler); events.set(args.event,list);
        return args.handler;
      }
      if (cmd === 'overlay_state') return {visible:false,clickThrough:true,monitors:[]};
      if (cmd === 'media_snapshot') return {activeId:'fixture',revision,sessions:[{...track,positionMs:
        track.positionMs + (track.playing ? performance.now() - changedAt : 0)}]};
      if (cmd === 'media_artwork') {
        const current = art, hash = String(track.artworkRevision);
        window.__artworkCalls[hash] = 'pending';
        await new Promise(resolve => setTimeout(resolve, hash === '3' ? 1800 : 20));
        window.__artworkCalls[hash] = 'returned';
        return {dataUrl:current, hash};
      }
      return null;
    }
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(){}};
}
"""


def run(args, checks):
    origin = urlsplit(args.url)
    assert origin.hostname == "127.0.0.1", "Use a local loopback server"
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True,
              args=["--disable-background-networking", "--no-proxy-server"])
        context = browser.new_context(viewport={"width":args.width,"height":args.height},
                                      service_workers="block")
        context.route("**/*", lambda route: route.continue_() if
                      urlsplit(route.request.url).netloc == origin.netloc else route.abort())
        context.add_init_script(f"({IPC})({json.dumps(dict(artwork=fixture_art(args.art),nextArtwork=fixture_art(warm=True)))})")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        expect(page.locator(".stage canvas")).to_be_visible()
        page.evaluate("document.fonts.ready")

        page.get_by_role("button",name="Live",exact=True).click()
        expect(page.locator("[data-end]")).to_have_text("3:49")
        expect(page.locator("[data-pos]")).to_have_text("1:33", timeout=5000)
        expect(page.get_by_role("progressbar",name="Live playback progress")).to_be_visible()
        expect(page.locator("[data-scrub]")).to_be_hidden()
        page.evaluate("__fixtureUpdate({playing:false,positionMs:43125})")
        expect(page.locator("[data-pos]")).to_have_text("0:43")
        page.get_by_role("button",name="Other players diagnostics").click()
        page.get_by_title("One second earlier").click()
        expect(page.locator("[data-pos]")).to_have_text("0:43")
        page.keyboard.press("Escape")
        page.wait_for_function("document.documentElement.style.getPropertyValue('--env-accent') !== ''")
        page.evaluate("__fixtureUpdate({title:'Intermediate fixture',generation:2,artworkRevision:3})")
        page.wait_for_function("__artworkCalls[3] === 'pending'")
        page.evaluate("__fixtureUpdate({title:'Second fixture',generation:3,artworkRevision:4,durationMs:0,positionMs:5100},true)")
        expect(page.locator(".track-caption")).to_contain_text("Second fixture")
        expect(page.locator("[data-end]")).to_have_text("—")
        expect(page.locator("[data-pos]")).to_have_text("0:05")
        expect(page.locator(".live-empty")).to_contain_text("Online lookup is off")
        warm_accent = """() => {
          const accent = document.documentElement.style.getPropertyValue('--env-accent');
          return /^#[0-9a-f]{6}$/i.test(accent) &&
            parseInt(accent.slice(1,3),16) > parseInt(accent.slice(5,7),16) + 40;
        }"""
        page.wait_for_function(warm_accent)
        page.wait_for_function("__artworkCalls[3] === 'returned'")
        # Give a mistakenly accepted stale palette time to finish blending.
        page.wait_for_timeout(950)
        assert page.evaluate(warm_accent), "The stale artwork replaced the newest track's palette"
        page.screenshot(path=args.out / "live-missing.png", animations="disabled")
        checks.append("live progresses beyond demo duration, freezes/seeks, ignores lyric nudge, reports unknown duration and rejects stale artwork")

        if not args.art:
            page.evaluate("__fixtureUpdate({artworkRevision:5},false)")
            page.wait_for_function("__artworkCalls[5] === 'returned'")
            page.wait_for_function(f"() => !({warm_accent})()")
        page.get_by_role("button",name="Demo",exact=True).click()
        expect(page.locator("[data-end]")).to_have_text("0:25")
        page.get_by_role("button",name="Pause demo",exact=True).click()
        page.get_by_role("slider",name="Demo position").fill("4250")
        page.get_by_role("button",name="Aesthetics",exact=True).click()
        page.get_by_label("Background",exact=True).select_option("zen")
        editor = page.get_by_role("region",name="Zen Gradient Editor")
        expect(editor).to_be_visible()
        editor.get_by_role("button",name="Add point").click()
        expect(editor.get_by_label("Light",exact=True)).to_have_value("4")
        editor.get_by_label("X %").fill("26")
        editor.get_by_label("Y %").fill("78")
        editor.get_by_label("Point colour hex").fill("#cc58ae")
        editor.get_by_label("Point colour hex").press("Tab")
        expect(editor.get_by_label("Use palette colours")).not_to_be_checked()
        pad = editor.locator(".zen-canvas")
        pad.scroll_into_view_if_needed()
        box = pad.bounding_box()
        page.mouse.move(box["x"]+box["width"]*.26,box["y"]+box["height"]*.78)
        page.mouse.down()
        page.mouse.move(box["x"]+box["width"]*.41,box["y"]+box["height"]*.70,steps=4)
        page.mouse.up()
        expect(editor.get_by_label("X %")).to_have_value("41")
        editor.get_by_role("button",name="Save gradient").click()
        editor.get_by_role("button",name="Remove",exact=False).click()
        editor.get_by_role("button",name="Load gradient").click()
        expect(editor.get_by_label("Light",exact=True).locator("option")).to_have_count(5)
        page.screenshot(path=args.out / "zen-editor.png", animations="disabled")
        checks.append("Zen mode opens immediately; point editing, dragging after rerender, preset save/remove/load")

        for mode in ("atmospheric", "liquid-glass", "artwork", "mesh", "zen", "minimal", "manual"):
            page.get_by_label("Background",exact=True).select_option(mode)
            page.keyboard.press("Escape")
            page.screenshot(path=args.out / f"mode-{mode}.png", animations="disabled")
            page.get_by_role("button",name="Aesthetics",exact=True).click()
        page.get_by_label("Background",exact=True).select_option("atmospheric")
        page.keyboard.press("Escape")
        buttons = page.locator(".pages button")
        expect(buttons).to_have_count(13)
        if not args.quick:
            for idx in range(13):
                buttons.nth(idx).click()
                page.screenshot(path=args.out / f"style-{idx+1:02}.png", animations="disabled")
            for label in ("Size","Font","Screen"):
                page.get_by_role("button",name=label,exact=True).click()
                popover = page.get_by_role("region",name=label,exact=True)
                bounds = popover.bounding_box()
                assert bounds and 0 <= bounds["x"] < args.width and bounds["x"] + bounds["width"] <= args.width
                assert 0 <= bounds["y"] < args.height and bounds["y"] + bounds["height"] <= args.height
                page.screenshot(path=args.out / f"panel-{label.lower()}.png", animations="disabled")
                page.keyboard.press("Escape")
            page.get_by_role("button",name="Expand",exact=True).click()
            page.screenshot(path=args.out / "gallery-expanded.png", animations="disabled")
        if args.motion:
            page.locator(".hero").scroll_into_view_if_needed()
            for index, name in enumerate(("ship", "fisheye")):
                buttons.nth(index).click()
                frames = args.out / name
                frames.mkdir()
                for frame in range(36):
                    page.locator("[data-scrub]").fill(str(2800 + 10 * round(frame * 100 / 12)))
                    page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                    page.locator(".stage").screenshot(path=frames / f"{frame:03d}.png")
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-threads", "2",
                                "-framerate", "12", "-i", str(frames / "%03d.png"),
                                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                                "-pix_fmt", "yuv420p", str(args.out / f"{name}.mp4")], check=True)
            checks.append("Ship and Fisheye reconstructed at 36 sampled demo timestamps each")
        assert not errors, errors
        checks.append("all seven shaders compile and 13 styles are present; no browser errors")
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",required=True)
    parser.add_argument("--out",required=True,type=Path)
    parser.add_argument("--art",type=Path,help="Optional private local thumbnail, never uploaded")
    parser.add_argument("--width",type=int,default=1280)
    parser.add_argument("--height",type=int,default=800)
    parser.add_argument("--quick",action="store_true")
    parser.add_argument("--motion",action="store_true",help="Sample Ship and Fisheye; requires FFmpeg")
    args = parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    checks = []
    try:
        run(args,checks)
    finally:
        (args.out / "checks.json").write_text(json.dumps(checks,indent=2),encoding="utf8")
    print(f"PASS: {args.out}")


if __name__ == "__main__":
    main()

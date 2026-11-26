"""Capture and smoke-test the local LyricMotion browser preview; no Tauri debug port."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


PRESENTATION = """durationMs => new Promise(resolve => {
  const intervals = [];
  let start, prev;
  function tick(now) {
    if (start === undefined) { start = prev = now; }
    else { intervals.push(now - prev); prev = now; }
    if (now - start < durationMs) requestAnimationFrame(tick);
    else {
      const ordered = [...intervals].sort((a, b) => a - b);
      resolve({elapsed_ms: now - start, intervals_ms: intervals,
        mean_callbacks_per_second: 1000 * intervals.length / (now - start),
        p95_interval_ms: ordered[Math.ceil(ordered.length * .95) - 1],
        over_20_ms: intervals.filter(v => v > 20).length,
        over_33_ms: intervals.filter(v => v > 33).length});
    }
  }
  requestAnimationFrame(tick);
})"""


def origin(url):
    parsed = urlsplit(url)
    return parsed.scheme, parsed.hostname, parsed.port


def run(args, results):
    permitted = origin(args.url)
    if permitted[0] != "http" or permitted[1] != "127.0.0.1":
        raise ValueError("Provide a local HTTP preview on 127.0.0.1")
    console_errors = []
    blocked = []
    results.update({"url": args.url, "viewport": [args.width, args.height], "channel": args.channel,
                    "console_errors": console_errors, "blocked_requests": blocked, "checks": []})
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.channel, headless=True,
                                             args=["--no-proxy-server", "--disable-background-networking"])
        results["browser_version"] = browser.version
        ctx = browser.new_context(viewport={"width": args.width, "height": args.height},
                                  device_scale_factor=1, service_workers="block")

        def route(r):
            if origin(r.request.url) == permitted:
                r.continue_()
            else:
                blocked.append(r.request.url)
                r.abort()

        def socket(ws):
            if origin(ws.url) == ("ws", permitted[1], permitted[2]):
                ws.connect_to_server()
            else:
                blocked.append(ws.url)
                ws.close()

        ctx.route("**/*", route)
        ctx.route_web_socket("**/*", socket)
        page = ctx.new_page()
        page.on("pageerror", lambda error: console_errors.append(str(error)))
        page.on("console", lambda message: console_errors.append(message.text)
                if message.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        expect(page.get_by_text("Eonara", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Demo", exact=True)).to_have_attribute("aria-pressed", "true")
        expect(page.locator(".stage canvas").first).to_be_visible()
        expect(page.locator(".track-caption").first).to_contain_text("Original demo")
        results["checks"].append("demo stage and canvas visible")
        page.evaluate("document.fonts.ready")
        pause = page.get_by_role("button", name="Pause demo", exact=True)
        pause.click()
        resume = page.get_by_role("button", name="Resume demo", exact=True)
        expect(resume).to_be_visible()
        scrub = page.get_by_role("slider", name="Demo position")
        scrub.fill("5600")
        expect(scrub).to_have_value("5600")
        page.screenshot(path=args.out / "demo.png", animations="disabled")
        results["checks"].append("demo pause and seek")

        title = page.locator(".style-meta .title")
        before = title.inner_text()
        page.get_by_role("button", name="Next style", exact=True).click()
        expect(title).not_to_have_text(before)
        expect(page.get_by_role("button", name="Select style", exact=True)).to_be_visible()
        page.get_by_role("button", name="Select style", exact=True).click()
        expect(page.locator('[data-action="select"]')).to_have_attribute("aria-pressed", "true")
        page.locator('[data-action="pin"]').click()
        expect(page.locator('[data-action="pin"]')).to_have_attribute("aria-pressed", "true")
        page.screenshot(path=args.out / "selected-style.png", animations="disabled")
        results["checks"].append("style changed, selected, and pinned")

        page.get_by_role("button", name="Screen", exact=True).click()
        panel = page.get_by_role("region", name="Screen", exact=True)
        expect(panel).to_be_visible()
        expect(panel.get_by_text("Desktop windows are available in the Windows build.")).to_be_visible()
        expect(panel.get_by_role("checkbox", name="Show desktop lyrics")).to_be_disabled()
        page.screenshot(path=args.out / "screen-panel.png", animations="disabled")
        page.keyboard.press("Escape")
        expect(panel).not_to_be_visible()
        results["checks"].append("Screen popover explains native-only control, closes with Escape")

        if args.presentation_seconds:
            results["presentation_style"] = title.inner_text()
            resume.click()
            page.wait_for_timeout(1000)  # let the preview's style/play transition settle
            results["presentation_headless_raf"] = page.evaluate(PRESENTATION, 1000 * args.presentation_seconds)
        if console_errors:
            raise AssertionError(f"Browser errors: {console_errors}")
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:1420/")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--channel", default="msedge")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=800)
    parser.add_argument("--presentation-seconds", type=float, default=0)
    args = parser.parse_args()
    if not 0 <= args.presentation_seconds <= 30:
        parser.error("--presentation-seconds must be 0–30")
    args.out.mkdir(parents=True, exist_ok=False)
    results = {}
    try:
        run(args, results)
    except Exception as error:
        results["failed"] = str(error)
        raise
    finally:
        (args.out / "browser.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"PASS; evidence: {args.out / 'browser.json'}")


if __name__ == "__main__":
    main()

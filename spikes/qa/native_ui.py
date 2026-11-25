"""Test-only loopback CDP adapter for the selected compiled LyricMotion WebView.

Does not enable debugging in Spotify, modify global browser settings or contact a
remote browser. OS input and HWND capture are separate qualification tools.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = 14626


def connect(p):
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
    pages = [page for context in browser.contexts for page in context.pages
             if page.url.startswith(("http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"))]
    main = [page for page in pages if "overlay=1" not in page.url]
    if len(main) != 1:
        raise RuntimeError(f"Expected one native main WebView, found {len(main)}")
    return browser, main[0], [page for page in pages if "overlay=1" in page.url]


def invoke(page, command, args=None):
    return page.evaluate("([cmd,args])=>window.__TAURI_INTERNALS__.invoke(cmd,args)", [command,args or {}])


def settings(page, patch):
    current = page.evaluate("JSON.parse(localStorage.getItem('lyricmotion.settings.v1')||'{}')")
    if not all(key in current for key in ("font","size","activeStyle","mode")):
        # A fresh profile need not have persisted its defaults. Never emit a
        # partial Settings object: initialize through the real UI save path.
        page.reload(wait_until="domcontentloaded")
        page.locator("[data-action=select]").wait_for()
        page.locator("[data-action=select]").evaluate("el=>el.click()")
        current = page.evaluate("JSON.parse(localStorage.getItem('lyricmotion.settings.v1')||'{}')")
        if not all(key in current for key in ("font","size","activeStyle","mode")):
            raise RuntimeError("Could not initialize complete native UI settings")
    current.update(patch)
    page.evaluate("""async s=>{
      localStorage.setItem('lyricmotion.settings.v1',JSON.stringify(s));
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'lyricmotion-settings',payload:s});
    }""",current)
    return current


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action",choices=["inspect","settings","eval"],default="inspect")
    parser.add_argument("--json",default="{}")
    parser.add_argument("--script",help="Explicit JavaScript expression evaluated only in the selected native main WebView")
    parser.add_argument("--out",type=Path)
    args = parser.parse_args()
    with sync_playwright() as p:
        _,page,_ = connect(p)
        if args.action == "settings":
            result = settings(page,json.loads(args.json))
        elif args.action == "eval":
            result = page.evaluate(args.script)
        else:
            result = {
                "identity":invoke(page,"native_diagnostics"),
                "overlay":invoke(page,"overlay_state"),
                "url":page.url,
                "viewport":page.evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,hidden:document.hidden})"),
                "transport":page.locator(".transport").inner_text() if page.locator(".transport").count() else "",
                "errors":page.locator("[role=alert]").all_text_contents(),
            }
        text = json.dumps(result,indent=2)
        if args.out:
            args.out.parent.mkdir(parents=True,exist_ok=True)
            args.out.write_text(text,encoding="utf8")
        else:
            print(text)

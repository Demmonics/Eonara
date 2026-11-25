"""App-HWND captures of original muted demos; not source-media synchronization proof."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

QA=Path(__file__).resolve().parents[1]/"spikes"/"qa"
sys.path.insert(0,str(QA))
from native_ui import connect,invoke


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out",required=True,type=Path)
    args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    records=[]
    with sync_playwright() as play:
        _,page,_=connect(play)
        identity=invoke(page,"native_diagnostics")
        page.locator('[data-action=demo]').evaluate("el=>el.click()")
        for style in ["ship","fisheye","message-thread"]:
            page.locator(f'.pages [data-value="{style}"]').evaluate("el=>el.click()")
            if page.locator('[data-action=pause]').get_attribute("aria-label")=="Pause demo":
                page.locator('[data-action=pause]').evaluate("el=>el.click()")
            page.locator('[data-scrub]').evaluate("el=>{el.value='14000';el.dispatchEvent(new Event('input',{bubbles:true}))}")
            time.sleep(.25)
            subprocess.run([sys.executable,"-B",str(QA/"capture_window.py"),"--pid",str(identity["processId"]),
                            "--title","^LyricMotion$","--out",str(args.out/f"{style}-14000.png")],check=True)
            page.locator('[data-action=pause]').evaluate("el=>el.click()")
            subprocess.run([sys.executable,"-B",str(QA/"capture_window.py"),"--pid",str(identity["processId"]),
                            "--title","^LyricMotion$","--out",str(args.out/f"{style}.mp4"),
                            "--seconds","6","--fps","15"],check=True)
            page.locator('[data-action=pause]').evaluate("el=>el.click()")
            records.append({"style":style,"identity":identity,"startPositionMs":14000,
                            "scope":"Native HWND; original muted demo; PrintWindow samples, not presentation FPS"})
    (args.out/"manifest.json").write_text(json.dumps(records,indent=2),encoding="utf8")

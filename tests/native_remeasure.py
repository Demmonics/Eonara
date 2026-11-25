"""Remeasure hidden-playing and overlay-only after the native visibility fix."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from playwright.sync_api import sync_playwright

QA=Path(__file__).resolve().parents[1]/"spikes"/"qa"
sys.path.insert(0,str(QA))
from native_ui import connect,invoke
import win32

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--session",required=True,type=Path)
    args=p.parse_args()
    session=args.session
    for name,overlay in [("bench-hidden-playing",False),("bench-overlay-only",True)]:
        with sync_playwright() as play:
            _,page,_=connect(play)
            identity=invoke(page,"native_diagnostics")
            pid=identity["processId"]
            assert not invoke(page,"native_window_visible")
            rows=invoke(page,"media_snapshot")["sessions"]
            source=next(s for s in rows if s["title"]=="LyricMotion QA Native Session")
            assert source["playing"]
            invoke(page,"overlay_show" if overlay else "overlay_hide")
            state={"identity":identity,"source":source,"mainNativeVisible":invoke(page,"native_window_visible"),
                   "mainDocumentHidden":page.evaluate("document.hidden"),"overlay":invoke(page,"overlay_state"),
                   "hwnds":win32.windows(r"^LyricMotion",pid)}
            (session/f"{name}-state.json").write_text(json.dumps(state,indent=2),encoding="utf8")
        if overlay:
            subprocess.run([sys.executable,"-B",str(QA/"capture_window.py"),"--pid",str(pid),"--title","^LyricMotion Overlay$",
                            "--out",str(session/"overlay-before-benchmark.png")],check=True)
        label=f"{identity['executableSha256'][:8]}; main hidden via close-to-tray with native guard false; muted original word fixture playing/looping; overlay {'populated 760x300 DIP DPR1.25 Ship backdrop0' if overlay else 'hidden'}"
        subprocess.run([sys.executable,"-B",str(QA/"session_benchmark.py"),"--pid",str(pid),
                        "--label",label,"--out",str(session/name)],check=True,timeout=210)
    with sync_playwright() as play:
        _,page,_=connect(play)
        invoke(page,"overlay_hide")
    with (session/"native-media"/"commands.txt").open("a",encoding="ascii") as f:f.write("pause\n")
    print("Completed fixed-candidate remeasurement",flush=True)

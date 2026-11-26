"""Approved sequential native scenarios. No captures/builds during sampling."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

QA=Path(__file__).resolve().parents[1]/"spikes"/"qa"
sys.path.insert(0,str(QA))
from native_ui import connect,invoke,settings
from native_spotify import control
import win32


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session",required=True,type=Path)
    args=parser.parse_args()
    session=args.session
    with sync_playwright() as p:
        browser,page,overlays=connect(p)
        pid=invoke(page,"native_diagnostics")["processId"]
        def state(name):
            data={"overlay":invoke(page,"overlay_state"),
                  "main":page.evaluate("()=>({hidden:document.hidden,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,caption:document.querySelector('.track-caption').textContent})"),
                  "hwnds":win32.windows(r"^Eonara",pid)}
            (session/f"{name}-state.json").write_text(json.dumps(data,indent=2),encoding="utf8")
        def hide_main():
            for hwnd,_,_ in win32.windows(r"^Eonara$",pid):
                win32.post_message(hwnd,0x10,0,0)
            time.sleep(.4)
            assert not win32.windows(r"^Eonara$",pid)
        def sample(name,label):
            subprocess.run([sys.executable,"-B",str(QA/"session_benchmark.py"),"--pid",str(pid),
                            "--label",label,"--out",str(session/name)],check=True,timeout=200)
        control("play")
        time.sleep(.7)
        assert control("inspect")["status"]=="Playing"
        state("bench-main-playing")
    sample("bench-main-playing","f5c5aedc; native main live playing; Reflections compilation source-word timing; Ship Atmospheric;1280x800 DIP DPR1.25;overlay hidden;gallery collapsed")
    # New CDP client only between measurement groups.
    with sync_playwright() as p:
        browser,page,overlays=connect(p)
        control("pause")
        time.sleep(.7)
        assert control("inspect")["status"]=="Paused"
        invoke(page,"overlay_hide")
        hide_main()
        state("bench-hidden")
    sample("bench-hidden","f5c5aedc; native close-to-tray; both HWNDs hidden; live source paused; no preview/overlay rendering requested")
    with sync_playwright() as p:
        browser,page,overlays=connect(p)
        rows=invoke(page,"media_snapshot")["sessions"]
        fixture=next(s for s in rows if s["title"]=="Eonara QA Native Session")
        settings(page,{"sourceId":fixture["id"],"autoLookup":True,"hidePaused":False,
                       "overlay":True,"clickThrough":True,"activeStyle":"ship","backdrop":0})
        invoke(page,"media_select",{"id":fixture["id"]})
        time.sleep(.5)
        settings(page,{"autoLookup":False})
        with (session/"native-media-03"/"commands.txt").open("a",encoding="ascii") as f:
            f.write("seek 0\nplay\n")
        invoke(page,"overlay_configure",{"monitor":"primary","position":"center",
                                        "size":{"width":760,"height":300}})
        invoke(page,"overlay_click_through",{"enabled":True})
        invoke(page,"overlay_show")
        time.sleep(.5)
        assert not win32.windows(r"^Eonara$",pid)
        state("bench-overlay-only")
    sample("bench-overlay-only","f5c5aedc; main hidden through close-to-tray; populated transparent Ship overlay 760x300 DIP DPR1.25; muted live SMTC author-stamped word fixture playing/looping; backdrop0")
    with sync_playwright() as p:
        _,page,_=connect(p)
        invoke(page,"overlay_hide")
        with (session/"native-media-03"/"commands.txt").open("a",encoding="ascii") as f:
            f.write("pause\n")
    print("Completed native benchmark state sequence",flush=True)


if __name__=="__main__":
    try:
        main()
    finally:
        # Do not leave real playback running if a later preflight/assertion fails.
        control("pause")

"""Approved-session application oracle with explicit IPC setup and real tray recovery.

Pointer/focus proof remains the existing cross-process native receiver oracle.
"""
import argparse
import builtins
import json
from pathlib import Path
import subprocess
import sys
from playwright.sync_api import sync_playwright

QA = Path(__file__).resolve().parents[1] / "spikes" / "qa"
sys.path.insert(0,str(QA))
from native_ui import connect, invoke, settings
import overlay_input_oracle as oracle
import win32


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out",type=Path,required=True)
    args = parser.parse_args()
    with sync_playwright() as p:
        _,page,_ = connect(p)
        identity = invoke(page,"native_diagnostics")
        pid = identity["processId"]
        settings(page,{"overlay":True,"hidePaused":False,"clickThrough":True,"backdrop":0})
        invoke(page,"overlay_configure",{"monitor":"primary","position":"center",
                                         "size":{"width":760,"height":300}})
        invoke(page,"overlay_click_through",{"enabled":True})
        invoke(page,"overlay_show")
        # Hide only the verified host's main HWND, not arbitrary foreground apps.
        for hwnd,owner,title in win32.windows(r"^Eonara$",pid):
            # Use the application's close-to-tray path, not raw ShowWindow:
            # otherwise the windowing library can retain a stale visible flag.
            win32.post_message(hwnd,0x0010,0,0)
        def prompt(text):
            if "Click-through OFF" in text:
                invoke(page,"overlay_click_through",{"enabled":False})
            elif "tray Show / Hide" in text:
                subprocess.run([sys.executable,str(QA/"tray_control.py"),"--action","Show / Hide Overlay",
                                "--pids",str(pid)],check=True,timeout=20)
            else:
                raise RuntimeError("Unknown manual setup step; refusing to silently skip it")
            return ""
        builtins.input = prompt
        sys.argv = ["overlay_input_oracle.py","app","--title","^Eonara Overlay$",
                    "--pid",str(pid),"--plan",str(Path(__file__).with_name("overlay_input_plan.json")),
                    "--out",str(args.out)]
        try:
            oracle.main()
        finally:
            invoke(page,"overlay_hide")

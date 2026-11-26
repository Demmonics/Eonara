"""Count actual native main WebGL submissions across close/tray/minimize.

Temporary test instrumentation is removed before performance sampling. Counts
prove submission suspension, not native presented FPS.
"""
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
from native_ui import connect,invoke
import win32

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out",type=Path,required=True)
    p.add_argument("--commands",type=Path,required=True)
    args=p.parse_args()
    records=[]
    with sync_playwright() as play:
        _,page,_=connect(play)
        pid=invoke(page,"native_diagnostics")["processId"]
        with args.commands.open("a",encoding="ascii") as f:f.write("play\n")
        page.locator('[data-action=live]').evaluate("el=>el.click()")
        time.sleep(.6)
        page.evaluate("""()=>{
          const proto=WebGL2RenderingContext.prototype;
          const saved={};
          window.__qaDrawCount=0;
          for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
            saved[name]=proto[name];
            proto[name]=function(...args){window.__qaDrawCount++;return saved[name].apply(this,args)};
          }
          window.__qaRestoreGL=()=>{for(const [name,fn] of Object.entries(saved))proto[name]=fn};
        }""")
        def sample(name):
            start=page.evaluate("window.__qaDrawCount")
            time.sleep(1)
            result={"case":name,"submittedDraws":page.evaluate("window.__qaDrawCount")-start,
                    "hostVisible":invoke(page,"native_window_visible"),
                    "documentHidden":page.evaluate("document.hidden")}
            records.append(result)
            return result
        try:
            assert sample("visible playing")["submittedDraws"]>0
            hwnd=win32.pick(r"^Eonara$",pid)[0]
            win32.post_message(hwnd,0x10,0,0)
            time.sleep(.4)
            hidden=sample("close-to-tray playing")
            assert not hidden["hostVisible"] and hidden["submittedDraws"]==0,hidden
            subprocess.run([sys.executable,str(QA/"tray_control.py"),"--action","Open Eonara",
                            "--pids",str(pid)],check=True)
            time.sleep(.3)
            assert sample("tray reopen playing")["submittedDraws"]>0
            win32.api(win32.user,"ShowWindow",w.BOOL,w.HWND,c.c_int)(hwnd,6)
            time.sleep(.4)
            minimized=sample("minimized playing")
            assert not minimized["hostVisible"] and minimized["submittedDraws"]==0,minimized
            subprocess.run([sys.executable,str(QA/"tray_control.py"),"--action","Open Eonara",
                            "--pids",str(pid)],check=True)
            time.sleep(.3)
            assert sample("tray restores minimized main")["submittedDraws"]>0
        finally:
            page.evaluate("window.__qaRestoreGL()")
            args.out.parent.mkdir(parents=True,exist_ok=True)
            args.out.write_text(json.dumps(records,indent=2),encoding="utf8")
    print("PASS: native visibility gates actual main WebGL submissions")

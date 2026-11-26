"""Approved native Spotify/GSMTC exercise. No Spotify private APIs or debug port."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

QA=Path(__file__).resolve().parents[1]/"spikes"/"qa"
sys.path.insert(0,str(QA))
from native_ui import connect,invoke,settings
from native_controlled_media import ui_state


def control(action,seconds=None):
    command=["powershell.exe","-NoProfile","-NonInteractive","-File",str(QA/"spotify_session.ps1"),"-Action",action]
    if seconds is not None:
        command+=["-Seconds",str(seconds)]
    result=subprocess.run(command,capture_output=True,text=True,timeout=12)
    if result.returncode:
        raise RuntimeError(f"Spotify {action}: {result.stdout} {result.stderr}")
    return json.loads(result.stdout)


def run(args):
    args.out.mkdir(parents=True,exist_ok=False)
    before=control("inspect")
    records=[{"case":"Spotify initial state","source":before}]
    with sync_playwright() as p:
        _,page,_=connect(p)
        def spotify():
            rows=invoke(page,"media_snapshot")["sessions"]
            return next((s for s in rows if "spotify" in s["source"].lower()),None)
        def expect(name,predicate):
            end=time.monotonic()+18
            while time.monotonic()<end:
                row=spotify()
                ui=ui_state(page)
                if row and predicate(row,ui):
                    records.append({"case":name,"native":row,"ui":ui,"pass":True})
                    print("PASS "+name,flush=True)
                    return row
                time.sleep(.2)
            raise AssertionError(f"{name}: {row}, {ui}")
        def artwork(name):
            row=spotify()
            art=invoke(page,"media_artwork",{"id":row["id"]})
            css=page.evaluate("""()=>Object.fromEntries(
              ['--env-accent','--env-glass','--env-popover','--env-fg'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue(k)]))""")
            value={"case":name,"title":row["title"],"hash":art.get("hash") if art else None,
                   "encodedBytes":len(art.get("dataUrl","")) if art else 0,"surfaceTokens":css}
            records.append(value)
            return value
        def diagnostic():
            if not page.locator('[data-action=retry-lyrics]').is_visible():
                page.locator('[data-player=Spotify]').evaluate("el=>el.click()")
            time.sleep(1)
            # Retain selected-source diagnostics only, never unrelated session titles.
            text=page.locator("#panel").inner_text()
            return "Session detected"+text.split("Session detected",1)[-1]
        try:
            row=expect("native detects Spotify",lambda s,u:s["title"]==before["title"])
            settings(page,{"sourceId":row["id"],"autoLookup":True,"estimated":False,
                           "matchArt":True,"paletteLocked":False,"mode":"atmospheric"})
            invoke(page,"media_select",{"id":row["id"]})
            page.locator('[data-action=live]').evaluate("el=>el.click()")
            control("play")
            expect("Spotify resume",lambda s,u:s["playing"] and before["title"] in u["caption"])
            control("seek",60)
            expect("Spotify seek reflected in native UI",lambda s,u:59000<=s["positionMs"]<=64000 and .23<u["fraction"]<.28)
            control("pause")
            expect("Spotify pause reflected by host",lambda s,u:not s["playing"])
            frozen=ui_state(page);time.sleep(1.2)
            assert abs(ui_state(page)["fraction"]-frozen["fraction"])<.002
            records.append({"case":"Spotify paused transport freezes","pass":True})
            control("play")
            expect("Spotify resumes again",lambda s,u:s["playing"])
            time.sleep(5)
            artwork("first real album artwork and surface")
            records.append({"case":"first lyrics diagnostic","text":diagnostic()})
            page.keyboard.press("Escape")
            subprocess.run([sys.executable,"-B",str(QA/"capture_window.py"),"--pid",str(invoke(page,"native_diagnostics")["processId"]),
                            "--title","^Eonara$","--out",str(args.out/"first-track.png")],check=True)
            control("next")
            expect("Spotify track switch replaces native metadata",lambda s,u:s["title"]!=before["title"] and s["title"] in u["caption"])
            time.sleep(5)
            artwork("second real album artwork and surface")
            records.append({"case":"second lyrics diagnostic","text":diagnostic()})
            page.keyboard.press("Escape")
            subprocess.run([sys.executable,"-B",str(QA/"capture_window.py"),"--pid",str(invoke(page,"native_diagnostics")["processId"]),
                            "--title","^Eonara$","--out",str(args.out/"second-track.png")],check=True)
        finally:
            try:
                control("pause")
                for _ in range(2):
                    current=control("inspect")
                    if current["title"]==before["title"] and current["album"]==before["album"]:
                        break
                    control("previous")
                    time.sleep(.8)
                current=control("inspect")
                matched=current["title"]==before["title"] and current["album"]==before["album"]
                if matched:
                    control("seek",before["positionMs"]/1000)
                    control("play" if before["status"]=="Playing" else "pause")
                # Skip commands can start playback even after an earlier pause.
                # Never leave a different recording playing after failed restoration.
                if not matched or before["status"]!="Playing":
                    control("pause")
                    deadline=time.monotonic()+8
                    while time.monotonic()<deadline:
                        current=control("inspect")
                        if current["status"]=="Paused":
                            break
                        time.sleep(.2)
                records.append({"case":"Spotify restoration result","exactRecordingRestored":matched,
                                "source":control("inspect")})
            finally:
                (args.out/"spotify-native.json").write_text(json.dumps(records,indent=2),encoding="utf8")


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out",type=Path,required=True)
    run(p.parse_args())

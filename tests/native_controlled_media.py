"""Native app + muted SMTC publisher integration; not an audio-latency oracle."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

QA = Path(__file__).resolve().parents[1] / "spikes" / "qa"
sys.path.insert(0,str(QA))
from native_ui import connect, invoke, settings


def ui_state(page):
    return page.evaluate("""()=>({
      position:document.querySelector('[data-pos]').textContent,
      end:document.querySelector('[data-end]').textContent,
      fraction:document.querySelector('.live-progress').value,
      caption:document.querySelector('.track-caption').textContent,
      empty:document.querySelector('.live-empty').hidden ? '' : document.querySelector('.live-empty').textContent,
      alert:document.querySelector('.status-banner').textContent
    })""")


def import_original(page, path):
    if not page.locator('[data-action=import-lyrics]').is_visible():
        page.locator('[data-player="Other players"]').evaluate("el=>el.click()")
    with page.expect_file_chooser() as chooser:
        page.locator('[data-action=import-lyrics]').click()
    chooser.value.set_files(path)
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        if page.evaluate("()=>document.querySelector('.notice')?.textContent.includes('attached')"):
            break
        time.sleep(.1)
    else:
        raise AssertionError("Native UI did not acknowledge local fixture import")
    page.keyboard.press("Escape")


def run(args):
    args.out.mkdir(parents=True,exist_ok=False)
    commands = args.out/"commands.txt"
    commands.touch()
    title = "Eonara QA Native Session"
    # Original author-stamped fixture; never described as Spotify/source audio timings.
    original = args.out/"original.lrc"
    original.write_text("\n".join(
        f"[00:{sec:02}.00]<00:{sec:02}.00>Silver <00:{sec+1:02}.00>headlights <00:{sec+2:02}.00>drift"
        for sec in range(0,57,3)),encoding="utf8")
    with (args.out/"publisher.log").open("w",encoding="utf8") as log:
        publisher = subprocess.Popen(["powershell.exe","-NoProfile","-NonInteractive","-File",
            str(QA/"smtc_publisher.ps1"),"-Title",title,"-HoldSeconds","1800",
            "-CommandsFile",str(commands.resolve())],stdout=log,stderr=log)
    (args.out/"publisher-pid.txt").write_text(str(publisher.pid))
    records=[]
    def command(text):
        with commands.open("a",encoding="ascii") as f:
            f.write(text+"\n")
    with sync_playwright() as p:
        _,page,overlays = connect(p)
        settings(page,{"autoLookup":False,"estimated":False,"sourceId":"","hidePaused":False})
        def sample(wanted):
            snap = invoke(page,"media_snapshot")
            return next((s for s in snap["sessions"] if s["title"] == wanted),None)
        def expect(name,predicate,wanted=title):
            end=time.monotonic()+15
            while time.monotonic()<end:
                row=sample(wanted)
                ui=ui_state(page)
                if predicate(row,ui):
                    records.append({"case":name,"native":row,"ui":ui,"pass":True})
                    print("PASS "+name,flush=True)
                    return row,ui
                time.sleep(.2)
            raise AssertionError(f"{name}: native={row}; ui={ui}")
        success=False
        try:
            session,_=expect("native host detects playing publisher",lambda s,u:s and s["playing"] and s["timelineValid"])
            settings(page,{"sourceId":session["id"]})
            invoke(page,"media_select",{"id":session["id"]})
            page.locator('[data-action=live]').evaluate("el=>el.click()")
            import_original(page,original.resolve())
            expect("native UI uses live duration",lambda s,u:s and u["end"]=="1:00" and "QA Native" in u["caption"])
            command("pause")
            expect("native pause",lambda s,u:s and not s["playing"])
            command("seek 31")
            expect("native paused seek and UI transport",lambda s,u:s and not s["playing"] and abs(s["positionMs"]-31000)<600 and u["position"]=="0:31")
            first=ui_state(page)
            time.sleep(1.2)
            second=ui_state(page)
            assert abs(first["fraction"]-second["fraction"])<.001,(first,second)
            records.append({"case":"paused UI freezes","before":first,"after":second,"pass":True})
            command("play")
            expect("native resume",lambda s,u:s and s["playing"])
            time.sleep(1.2)
            expect("live UI advances after resume",lambda s,u:s and u["fraction"]>31.5/60)
            command("title "+title+" next")
            expect("track change replaces metadata and clears lyrics",lambda s,u:s and "next" in u["caption"] and bool(u["empty"]),title+" next")
            command("title "+title)
            expect("original fixture restored",lambda s,u:s and "next" not in u["caption"])
            # Force both surfaces to reread the permitted shared local import.
            settings(page,{"autoLookup":True})
            time.sleep(.4)
            settings(page,{"autoLookup":False})
            command("pause")
            command("seek 31")
            expect("fixture ready for controlled measurements",lambda s,u:s and not s["playing"] and u["position"]=="0:31")
            success=True
        finally:
            (args.out/"native-media.json").write_text(json.dumps(records,indent=2),encoding="utf8")
            if not args.keep or not success:
                command("exit")
                publisher.wait(timeout=8)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out",required=True,type=Path)
    p.add_argument("--keep",action="store_true",help="Leave muted publisher for subsequent approved benchmarks; explicit exit required")
    run(p.parse_args())

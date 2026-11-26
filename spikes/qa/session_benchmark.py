"""Run labelled native CPU/memory/GPU samples after rejecting competing QA/build work.

No window or media controls: operator sets a scenario first. GPU engine counters
are separate from presented-frame rate and are retained only for this app family.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import psutil

QA = Path(__file__).resolve().parent
BLOCKED = {"cargo.exe","rustc.exe","link.exe","cl.exe","emulator.exe",
           "qemu-system-x86_64.exe","qemu-system-aarch64.exe","ffmpeg.exe",
           "obs64.exe","blender.exe"}


def preflight():
    blockers = []
    for process in psutil.process_iter(["pid","name"]):
        name = (process.info["name"] or "").lower()
        if name in BLOCKED:
            blockers.append({"pid":process.pid,"kind":name})
        elif name in {"node.exe","python.exe"} and process.pid != psutil.Process().pid:
            try:
                command = " ".join(process.cmdline()).lower()
                if any(marker in command for marker in
                       ["vite.js","vitest","visual_fixtures.py","motion_lane_visual.py",
                        "browser_visual.py","browser_v03.py","playwright test","tauri build"]):
                    blockers.append({"pid":process.pid,"kind":"browser/build test"})
            except (psutil.NoSuchProcess,psutil.AccessDenied):
                pass
    if blockers:
        raise RuntimeError(f"Competing compiler/emulator/capture/test work is active: {blockers}")
    return {"utc":datetime.now(timezone.utc).isoformat(),"blockers":blockers,
            "scope":"process-based check; cannot attest future agent activity or all unrelated system load"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid",required=True,type=int)
    parser.add_argument("--label",required=True)
    parser.add_argument("--out",required=True,type=Path)
    parser.add_argument("--repetitions",type=int,default=3)
    args = parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    host = psutil.Process(args.pid)
    if host.name().lower() not in {"eonara.exe", "lyricmotion.exe"}:
        raise RuntimeError("Selected PID is not Eonara")
    identity = host.create_time()
    for rep in range(1,args.repetitions+1):
        gate = preflight()
        if host.create_time() != identity:
            raise RuntimeError("Host process identity changed")
        family = [host,*host.children(recursive=True)]
        ids = [p.pid for p in family]
        gate["family"] = [{"pid":p.pid,"name":p.name(),"created":p.create_time()} for p in family]
        (args.out/f"preflight-{rep}.json").write_text(json.dumps(gate,indent=2),encoding="utf8")
        gpu_out = args.out/f"gpu-{rep}.json"
        command = f"& '{QA/'gpu_sample.ps1'}' -ProcessIds @({','.join(map(str,ids))}) -Out '{gpu_out.resolve()}' -Samples 35"
        with (args.out/f"gpu-{rep}.log").open("w",encoding="utf8") as log:
            gpu = subprocess.Popen(["powershell.exe","-NoProfile","-NonInteractive","-Command",command],
                                   stdout=log,stderr=log)
            try:
                subprocess.run([sys.executable,"-B",str(QA/"benchmark_process.py"),"--pid",str(args.pid),
                                "--label",args.label,"--seconds","30","--interval","0.5","--warmup","5",
                                "--out",str(args.out/f"cpu-{rep}.json")],check=True,timeout=55)
                code = gpu.wait(timeout=15)
                if code:
                    print(f"GPU collector failed ({code}); retain log, do not claim GPU pass",flush=True)
            finally:
                if gpu.poll() is None:
                    gpu.terminate()
        post = preflight()
        (args.out/f"postflight-{rep}.json").write_text(json.dumps(post,indent=2),encoding="utf8")
        print(f"Completed repetition {rep}: {args.label}",flush=True)


if __name__ == "__main__":
    main()

"""Verify a muted local SMTC publisher against a separate GSMTC reader."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

QA = Path(__file__).resolve().parents[1] / "spikes" / "qa"
PS = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]


def sample(title):
    result = subprocess.run(PS + [str(QA / "smtc_probe.ps1"), "-Title", title],
                            capture_output=True, text=True, timeout=15)
    if result.returncode == 3:
        return None
    if result.returncode:
        raise RuntimeError(f"GSMTC probe exit {result.returncode}: {result.stderr.strip()}")
    return json.loads(result.stdout)


def run(out, records):
    title = "LyricMotion QA " + uuid.uuid4().hex[:10]
    renamed = title + " next"
    commands = out / "commands.txt"
    commands.touch()
    with (out / "publisher.jsonl").open("w", encoding="utf-8") as log, \
         (out / "publisher-errors.txt").open("w", encoding="utf-8") as error:
        with subprocess.Popen(PS + [str(QA / "smtc_publisher.ps1"), "-Title", title,
                                    "-HoldSeconds", "100", "-CommandsFile", str(commands)],
                              stdout=log, stderr=error) as publisher:
            def command(line):
                with commands.open("a", encoding="ascii") as stream:
                    stream.write(line + "\n")

            def expect(name, wanted, predicate):
                deadline = time.monotonic() + 12
                while time.monotonic() < deadline:
                    value = sample(wanted)
                    records.append({"case": name, "sample": value})
                    if predicate(value):
                        records[-1]["pass"] = True
                        print(f"PASS {name}", flush=True)
                        return
                    time.sleep(0.25)
                raise AssertionError(f"SMTC did not reach {name}: {records[-1]}")

            try:
                expect("playing local metadata", title,
                       lambda s: s and s["status"] == "Playing" and s["duration_ms"] == 60000
                       and s["artist"] == "LyricMotion QA" and s["album"] == "Offline SMTC Fixture")
                command("pause")
                expect("paused", title, lambda s: s and s["status"] == "Paused")
                command("seek 31")
                expect("seek while paused", title,
                       lambda s: s and s["status"] == "Paused" and abs(s["position_ms"] - 31000) < 1000)
                command("play")
                expect("resumed", title, lambda s: s and s["status"] == "Playing")
                command(f"title {renamed}")
                expect("metadata updated", renamed, lambda s: s and s["status"] == "Playing")
                command("exit")
                publisher.wait(timeout=6)
                if publisher.returncode:
                    raise RuntimeError(f"Publisher exit {publisher.returncode}; see publisher-errors.txt")
                expect("session removed", renamed, lambda s: s is None)
            finally:
                if publisher.poll() is None:
                    command("exit")
                    try:
                        publisher.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        publisher.terminate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    records = []
    try:
        run(out, records)
    except Exception as error:
        records.append({"failed": str(error)})
        raise
    finally:
        (out / "smtc.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

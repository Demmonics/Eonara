"""Desktop-only regression: real pointer input and cross-process WM_LBUTTON proof."""
import argparse
from contextlib import contextmanager
import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path
import subprocess
import sys
import time

QA = Path(__file__).resolve().parents[1] / "spikes" / "qa"
sys.path.insert(0, str(QA))
import win32 as win


def wait_for(predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if result := predicate():
            return result
        time.sleep(0.03)
    raise RuntimeError("Timed out waiting for native fixture readiness/ack")


def read_log(path):
    if not path.exists():
        return []
    # A producer may be writing the last line, so only consume complete lines.
    return [json.loads(line) for line in path.read_bytes().split(b"\n")[:-1]]


@contextmanager
def fixture(path, bounds, layered=False, topmost=False):
    x, y, r, b = bounds
    args = [sys.executable, str(QA / "input_fixture.py"), "--log", str(path),
            "--x", str(x), "--y", str(y), "--width", str(r - x), "--height", str(b - y)]
    if layered:
        args.append("--layered")
    if topmost:
        args.append("--topmost")
    with subprocess.Popen(args) as proc:
        hwnd = None
        try:
            def ready():
                if proc.poll() is not None:
                    raise RuntimeError(f"Fixture exited {proc.returncode}")
                return next((e for e in read_log(path) if e["event"] == "ready"
                             and e["pid"] == proc.pid), None)
            hwnd = wait_for(ready)["hwnd"]
            yield hwnd, path
        finally:
            if hwnd:
                win.post_message(hwnd, 0x0010, 0, 0)  # Only our own process.
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.terminate()


def events_after(path, start):
    return [row for row in read_log(path)[start:] if row["event"] in ("down", "up")]


def verify_click(events, received, point):
    expect = [("down", *point), ("up", *point)] if received else []
    actual = [(e["event"], e["x"], e["y"]) for e in events]
    if actual != expect:
        raise AssertionError(f"Fixture mouse events {actual}, expected {expect}")


def place_behind(hwnd, overlay, bounds):
    x, y, r, b = bounds
    # Sibling immediately below the overlay; the fixture must not hide the target.
    win.require(win.set_window_pos(hwnd, overlay, x, y, r - x, b - y, 0x0010),
                "SetWindowPos(fixture behind overlay)")
    order = [item[0] for item in win.windows()]
    if order.index(overlay) >= order.index(hwnd):
        raise RuntimeError("Overlay is below receiver in desktop Z order")


def position(box, fractions):
    x, y, r, b = box
    if len(fractions) != 2 or not all(isinstance(n, (int, float)) and 0 <= n < 1
                                     for n in fractions):
        raise ValueError(f"Not a client-fraction pair: {fractions}")
    return x + int((r - x) * fractions[0]), y + int((b - y) * fractions[1])


def monitor_area(hwnd):
    class MonitorInfo(c.Structure):
        _fields_ = [("size", w.DWORD), ("screen", w.RECT), ("work", w.RECT), ("flags", w.DWORD)]
    nearest = win.api(win.user, "MonitorFromWindow", w.HANDLE, w.HWND, w.DWORD)(hwnd, 2)
    info = MonitorInfo(c.sizeof(MonitorInfo))
    win.require(win.api(win.user, "GetMonitorInfoW", w.BOOL, w.HANDLE, c.POINTER(MonitorInfo))(
        nearest, c.byref(info)), "GetMonitorInfoW")
    return info.work.left, info.work.top, info.work.right, info.work.bottom


def contains(bounds, point):
    x, y, r, b = bounds
    return x <= point[0] < r and y <= point[1] < b


def receiver_control(hwnd, path, bounds, overlay):
    box = win.rect(overlay)
    points = [position(bounds, (x, y)) for x in (0.03, 0.5, 0.97) for y in (0.03, 0.5, 0.97)]
    point = next((pt for pt in points
                  if not contains(box, pt) and win.hit_window(pt)["hit_root"] == hwnd), None)
    if point is None:
        raise RuntimeError("Receiver positive control is obscured; leave uncovered monitor space and dismiss overlays")
    start = len(read_log(path))
    win.gesture(point)
    time.sleep(0.28)
    events = events_after(path, start)
    verify_click(events, True, point)
    if not win.owns_foreground(win.pid_for(hwnd)):
        raise AssertionError("Receiver control did not make receiver the foreground process")
    return {"case": "receiver positive control", "point": point, "receiver_events": events}


def self_test(out, result):
    width = win.api(win.user, "GetSystemMetrics", c.c_int, c.c_int)(0)
    height = win.api(win.user, "GetSystemMetrics", c.c_int, c.c_int)(1)
    bounds = (width // 3, height // 3, width // 3 + 240, height // 3 + 160)
    with fixture(out / "selftest-receiver.jsonl", bounds, topmost=True) as (bottom, bottom_log), \
         fixture(out / "selftest-layered.jsonl", bounds, layered=True, topmost=True) as (top, top_log):
        assert win.pid_for(bottom) != win.pid_for(top)
        for passing in (False, True, False):
            place_behind(bottom, top, bounds)
            start_bottom, start_top = len(read_log(bottom_log)), len(read_log(top_log))
            win.require(win.post_message(top, 0x8001, int(passing), 0), "PostMessage(control mode)")
            wait_for(lambda: any(e["event"] == "mode" and e["pass_through"] == passing
                                 for e in read_log(top_log)[start_top:]))
            point = position(bounds, (0.5, 0.5))
            win.gesture(point)
            time.sleep(0.35)
            bottom_events = events_after(bottom_log, start_bottom)
            top_events = events_after(top_log, start_top)
            result.append({"case": "cross-process layered control", "pass_through": passing,
                           "receiver_events": bottom_events, "layered_events": top_events,
                           "point": point, **win.hit_window(point)})
            verify_click(bottom_events, passing, point)
            verify_click(top_events, not passing, point)
            result[-1]["pass"] = True


def regression(args, out, results):
    overlay, overlay_pid, title = win.pick(args.title, args.pid)
    target_style = win.get_style(overlay, -20)
    if not target_style & 8 and not args.allow_not_topmost:
        raise RuntimeError("Target is not WS_EX_TOPMOST; enable overlay always-on-top to run this plan")
    results.append({"case": "target", "hwnd": overlay, "pid": overlay_pid, "title": title,
                    "initial_exstyle": hex(target_style)})
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    if not isinstance(plan, list) or not plan:
        raise ValueError("Regression plan must be a nonempty JSON list")
    show = win.api(win.user, "ShowWindow", w.BOOL, w.HWND, c.c_int)
    with fixture(out / "app-receiver.jsonl", monitor_area(overlay),
                 topmost=bool(target_style & 8)) as (hwnd, path):
        if win.pid_for(hwnd) == overlay_pid:
            raise AssertionError("Fixture is not a different process")
        for step in plan:
            name = step["name"]
            if prompt := step.get("prompt"):
                show(hwnd, 0)
                input(f"{name}: {prompt}\nPress Enter here after setting up the app… ")
                show(hwnd, 4)
            bounds = monitor_area(overlay)
            place_behind(hwnd, overlay, bounds)
            control = receiver_control(hwnd, path, bounds, overlay)
            results.append({"for": name, **control})
            place_behind(hwnd, overlay, bounds)  # Re-establish ordering after the control click.
            before = win.rect(overlay)
            client = win.rect(overlay, client=True)
            point = position(client, step["point"])
            delta = step.get("delta")
            endpoint = tuple(a + b for a, b in zip(point, delta)) if delta else point
            if not all(contains(bounds, pt) for pt in (point, endpoint)):
                raise ValueError(f"{name}: gesture must be on the receiver monitor work area")
            start = len(read_log(path))
            if step.get("recovery_shortcut"):
                win.recovery_shortcut()
                try:
                    wait_for(lambda: not win.is_visible(overlay))
                except RuntimeError:
                    raise AssertionError(f"{name}: Ctrl+Alt+Shift+L did not hide the overlay") from None
            hit_before = win.gesture(point, delta, args.settle)
            time.sleep(args.observe)
            events = events_after(path, start)
            after = win.rect(overlay) if win.is_window(overlay) else None
            visible = bool(after and win.is_visible(overlay))
            fg = win.foreground()
            fg_pid = win.pid_for(fg) if fg else None
            style = win.get_style(overlay, -20) if after else None
            entry = {"case": name, "point": point, "delta": delta, "before": before, "after": after,
                     "receiver_events": events, "foreground_pid": fg_pid, "visible": visible,
                     "hit_before": hit_before, "hit_after": win.hit_window(point),
                     "exstyle_after": hex(style) if style is not None else None}
            results.append(entry)
            expectation = step["receiver"]
            if expectation not in ("click", "none"):
                raise ValueError(f"{name}: receiver must be click or none")
            if expectation == "click" and delta:
                raise ValueError(f"{name}: use a stationary gesture for a click assertion")
            verify_click(events, expectation == "click", point)
            hit = step.get("hit")
            if hit and hit_before["hit_root"] != {"receiver": hwnd, "app": overlay}[hit]:
                raise AssertionError(f"{name}: WindowFromPoint did not resolve to {hit}")
            if "pass_through_style" in step and (
                style is None or bool(style & 0x20) != step["pass_through_style"]
            ):
                raise AssertionError(f"{name}: WS_EX_TRANSPARENT did not match expected state")
            effect = step.get("overlay", "unchanged")
            if effect not in ("moved", "resized", "closed", "hidden", "unchanged", "any"):
                raise ValueError(f"{name}: unknown overlay assertion {effect}")
            if effect == "closed":
                if after is not None:
                    raise AssertionError(f"{name}: overlay remained open")
            elif effect == "hidden":
                if after is None or visible:
                    raise AssertionError(f"{name}: expected a hidden, still-existing overlay HWND")
            elif effect != "any":
                if not visible:
                    raise AssertionError(f"{name}: overlay unexpectedly hidden or closed")
                if effect == "unchanged" and before != after:
                    raise AssertionError(f"{name}: overlay moved/resized from {before} to {after}")
                if effect == "moved" and max(abs(a - b) for a, b in zip(before[:2], after[:2])) < 6:
                    raise AssertionError(f"{name}: overlay did not move ≥ 6 px")
                old_size = (before[2] - before[0], before[3] - before[1])
                new_size = (after[2] - after[0], after[3] - after[1])
                if effect == "resized" and max(abs(a - b) for a, b in zip(old_size, new_size)) < 6:
                    raise AssertionError(f"{name}: overlay did not resize ≥ 6 px")
            fg_want = step.get("foreground")
            foreground_pids = {"receiver": win.pid_for(hwnd), "app": overlay_pid}
            if fg_want and fg_pid != foreground_pids[fg_want]:
                raise AssertionError(f"{name}: foreground was PID {fg_pid}, not {fg_want}")
            entry["pass"] = True
            print(f"PASS {name}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("list", "self-test", "app"))
    parser.add_argument("--title", help="Regex for target window title")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--plan")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--settle", type=float, default=0.24,
                        help="Seconds after pointer arrival, before press")
    parser.add_argument("--observe", type=float, default=0.35,
                        help="Seconds after release, before assertions")
    parser.add_argument("--allow-not-topmost", action="store_true")
    args = parser.parse_args()
    win.dpi_aware()
    if args.mode == "list":
        print(json.dumps(win.windows(args.title, args.pid), indent=2))
        return
    if not args.out or (args.mode == "app" and (not args.plan or not (args.title or args.pid))):
        parser.error("A new --out directory is required; app mode also needs --plan and --title or --pid")
    if not 0 <= args.settle <= 3 or not 0.05 <= args.observe <= 5:
        parser.error("--settle must be 0–3s and --observe must be 0.05–5s")
    args.out.mkdir(parents=True, exist_ok=False)
    original = win.cursor()
    results = []
    try:
        if args.mode == "self-test":
            self_test(args.out, results)
        else:
            regression(args, args.out, results)
    except Exception as error:
        results.append({"failed": str(error)})
        raise
    finally:
        (args.out / "oracle.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
        try:
            win.move(*original)
        except (RuntimeError, OSError):
            print("Could not restore the original pointer position", file=sys.stderr)
    print(f"PASS; evidence: {args.out / 'oracle.json'}")


if __name__ == "__main__":
    main()

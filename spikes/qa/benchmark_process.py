"""Measure Windows process-tree CPU and memory without debugging or launching the app."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import math
import os
from pathlib import Path
import platform
import statistics
import time

import win32 as win


class ProcessEntry(c.Structure):
    _fields_ = [("size", w.DWORD), ("use_count", w.DWORD), ("pid", w.DWORD),
                ("heap", c.c_size_t), ("module", w.DWORD), ("threads", w.DWORD),
                ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD),
                ("name", w.WCHAR * 260)]


class MemoryCounters(c.Structure):
    _fields_ = [("size", w.DWORD), ("page_faults", w.DWORD)] + [
        (name, c.c_size_t) for name in (
            "peak_working_set", "working_set", "peak_paged_pool", "paged_pool",
            "peak_nonpaged_pool", "nonpaged_pool", "pagefile", "peak_pagefile", "private")
    ]


close_handle = win.api(win.kernel, "CloseHandle", w.BOOL, w.HANDLE)
open_process = win.api(win.kernel, "OpenProcess", w.HANDLE, w.DWORD, w.BOOL, w.DWORD)
process_times = win.api(win.kernel, "GetProcessTimes", w.BOOL, w.HANDLE, *([c.POINTER(w.FILETIME)] * 4))
get_memory = win.api(c.WinDLL("psapi", use_last_error=True), "GetProcessMemoryInfo",
                     w.BOOL, w.HANDLE, c.POINTER(MemoryCounters), w.DWORD)


def snapshot():
    handle = win.api(win.kernel, "CreateToolhelp32Snapshot", w.HANDLE, w.DWORD, w.DWORD)(2, 0)
    win.require(handle != c.c_void_p(-1).value, "CreateToolhelp32Snapshot")
    first = win.api(win.kernel, "Process32FirstW", w.BOOL, w.HANDLE, c.POINTER(ProcessEntry))
    next_process = win.api(win.kernel, "Process32NextW", w.BOOL, w.HANDLE, c.POINTER(ProcessEntry))
    out = {}
    try:
        entry = ProcessEntry(c.sizeof(ProcessEntry))
        win.require(first(handle, c.byref(entry)), "Process32FirstW")
        while True:
            out[entry.pid] = (entry.parent, entry.name)
            if not next_process(handle, c.byref(entry)):
                break
    finally:
        close_handle(handle)
    return out


def process(pid):
    handle = open_process(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        created, exited, kernel, user = (w.FILETIME() for _ in range(4))
        if not process_times(handle, *(c.byref(t) for t in (created, exited, kernel, user))):
            return None

        def ticks(t):
            return (t.dwHighDateTime << 32) | t.dwLowDateTime

        memory = MemoryCounters(c.sizeof(MemoryCounters))
        if not get_memory(handle, c.byref(memory), c.sizeof(memory)):
            return None
        return {"created_100ns": ticks(created), "cpu_seconds": (ticks(kernel) + ticks(user)) / 1e7,
                "working_set_bytes": memory.working_set, "private_bytes": memory.private}
    finally:
        close_handle(handle)


def family(root, root_identity):
    table = snapshot()
    if root not in table:
        raise RuntimeError(f"Root PID {root} exited")
    children = {root}
    while True:
        extended = children | {pid for pid, row in table.items() if row[0] in children}
        if children == extended:
            break
        children = extended
    entries = {}
    unavailable = []
    for pid in sorted(children):
        counters = process(pid)
        if counters is None:
            unavailable.append(pid)
        else:
            entries[pid] = {"name": table[pid][1], **counters}
    if root not in entries or entries[root]["created_100ns"] != root_identity:
        raise RuntimeError(f"Root PID {root} exited, changed identity, or could not be measured")
    return entries, unavailable


def stats(values):
    values = sorted(values)
    return {"median": statistics.median(values), "p95": values[math.ceil(len(values) * 0.95) - 1],
            "max": values[-1]}


def run(args, pid):
    identity = process(pid)
    if identity is None:
        raise RuntimeError(f"Cannot read counters for PID {pid}")
    seen = set()
    missed = set()
    rows = []
    prev, prev_t = {}, None
    start = time.perf_counter()
    for index in range(round(args.seconds / args.interval) + 1):
        remaining = start + index * args.interval - time.perf_counter()
        if remaining > 0:
            time.sleep(remaining)
        entries, unavailable = family(pid, identity["created_100ns"])
        now = time.perf_counter()
        seen.update(row["name"] for row in entries.values())
        missed.update(unavailable)
        old = {k: v for k, v in prev.items() if k in entries and
               entries[k]["created_100ns"] == v["created_100ns"]}
        delta = None if prev_t is None else now - prev_t
        cpu = (None if delta is None else
               sum(entries[k]["cpu_seconds"] - old[k]["cpu_seconds"] for k in old))
        rows.append({"offset_seconds": now - start, "interval_seconds": delta,
                     "cpu_seconds_delta": cpu, "cpu_percent_one_core": round(100 * cpu / delta, 5)
                     if delta else None,
                     "working_set_bytes": sum(v["working_set_bytes"] for v in entries.values()),
                     "private_bytes": sum(v["private_bytes"] for v in entries.values()),
                     "unavailable_pids": unavailable, "processes": entries})
        prev, prev_t = entries, now
    cpu_rows = rows[1:]
    summary = {
        "cpu_percent_one_core": stats([r["cpu_percent_one_core"] for r in cpu_rows]),
        "time_weighted_cpu_percent_one_core": 100 * sum(r["cpu_seconds_delta"] for r in cpu_rows)
        / sum(r["interval_seconds"] for r in cpu_rows),
        "tree_working_set_mib": stats([r["working_set_bytes"] / 2**20 for r in rows]),
        "tree_private_mib": stats([r["private_bytes"] / 2**20 for r in rows]),
        "executables_observed": sorted(seen), "unavailable_pids_observed": sorted(missed),
    }
    return {"scenario": args.label, "os": platform.platform(), "logical_cpus": os.cpu_count(),
            "root_pid": pid, "requested_seconds": args.seconds, "interval": args.interval,
            "warmup_seconds": args.warmup, "summary": summary, "samples": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--pid", type=int)
    selector.add_argument("--title", help="Regex for a unique visible app window title")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--label", required=True, help="Scenario and operator settings")
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--warmup", type=float, default=5.0)
    args = parser.parse_args()
    if (not 0.1 <= args.interval <= 5 or not 2 * args.interval <= args.seconds <= 600
            or not 0 <= args.warmup <= 120):
        parser.error("Use 0.1–5 s interval, 2+ intervals up to 600 s total, and 0–120 s warmup")
    if args.out.exists():
        parser.error("Output exists; choose a fresh path")
    win.dpi_aware()
    pid = args.pid or win.pick(args.title, None)[1]
    print(f"PID {pid}; prepare {args.label!r}; starting in {args.warmup:g} s.", flush=True)
    time.sleep(args.warmup)
    result = run(args, pid)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8") as file:
        file.write(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()

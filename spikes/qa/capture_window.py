"""Capture only the given HWND using PrintWindow; never capture the desktop."""
import argparse
from contextlib import contextmanager
import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path
import shutil
import subprocess
import time

import win32 as win


class Dib(c.Structure):
    _fields_ = [("size", w.DWORD), ("width", w.LONG), ("height", w.LONG),
                ("planes", w.WORD), ("depth", w.WORD), ("compression", w.DWORD),
                ("image_size", w.DWORD), ("xppm", w.LONG), ("yppm", w.LONG),
                ("colors", w.DWORD), ("important_colors", w.DWORD)]


@contextmanager
def surface(width, height):
    dc = win.require(win.api(win.gdi, "CreateCompatibleDC", w.HDC, w.HDC)(None),
                     "CreateCompatibleDC")
    pixels = c.c_void_p()
    info = Dib(c.sizeof(Dib), width, -height, 1, 32)  # top-down BGR0
    create = win.api(win.gdi, "CreateDIBSection", w.HBITMAP, w.HDC, c.POINTER(Dib),
                     w.UINT, c.POINTER(c.c_void_p), w.HANDLE, w.DWORD)
    delete = win.api(win.gdi, "DeleteObject", w.BOOL, w.HANDLE)
    select = win.api(win.gdi, "SelectObject", w.HANDLE, w.HDC, w.HANDLE)
    bitmap = None
    old = None
    try:
        bitmap = win.require(create(dc, c.byref(info), 0, c.byref(pixels), None, 0),
                             "CreateDIBSection")
        old = win.require(select(dc, bitmap), "SelectObject")
        yield dc, pixels
    finally:
        if old:
            select(dc, old)
        if bitmap:
            delete(bitmap)
        win.api(win.gdi, "DeleteDC", w.BOOL, w.HDC)(dc)


def window_size(hwnd):
    x, y, r, b = win.rect(hwnd)
    return r - x, b - y


def nonblank(frame, width, height):
    # Ignore alpha: PrintWindow isn't proof of native per-pixel compositing.
    base = frame[:3]
    for y in range(0, height, max(1, height // 120)):
        for x in range(0, width, max(1, width // 120)):
            i = 4 * (y * width + x)
            if frame[i:i + 3] != base:
                return True
    return False


def capture(args):
    hwnd, pid, title = win.pick(args.title, args.pid)
    width, height = window_size(hwnd)
    if width <= 0 or height <= 0 or width * height > 32_000_000:
        raise RuntimeError(f"Unsupported dimensions {width}x{height}")
    output = args.out.absolute()
    metadata = output.with_suffix(output.suffix + ".json")
    if output.exists() or metadata.exists():
        raise RuntimeError("Output or metadata already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not on PATH")
    print_window = win.api(win.user, "PrintWindow", w.BOOL, w.HWND, w.HDC, w.UINT)
    flush = win.api(win.gdi, "GdiFlush", w.BOOL)
    count = max(1, round(args.seconds * args.fps)) if output.suffix == ".mp4" else 1
    source = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-f",
              "rawvideo", "-pixel_format", "bgr0", "-video_size", f"{width}x{height}",
              "-framerate", str(args.fps), "-i", "pipe:0", "-an"]
    encoding = (["-frames:v", "1", "-update", "1"] if output.suffix == ".png" else
                ["-c:v", "libx264", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt",
                 "yuv420p", "-movflags", "+faststart"])
    size = width * height * 4
    blank = 0
    stamps = []
    start = time.perf_counter()
    temporary = output.with_name(output.stem + ".capture-partial" + output.suffix)
    if temporary.exists():
        raise RuntimeError(f"Temporary output already exists: {temporary}")
    try:
        with surface(width, height) as (dc, pixels), \
             subprocess.Popen(source + encoding + [str(temporary)], stdin=subprocess.PIPE) as encoder:
            for i in range(count):
                remaining = start + i / args.fps - time.perf_counter()
                if remaining > 0:
                    time.sleep(remaining)
                if not win.is_window(hwnd) or win.is_iconic(hwnd) or window_size(hwnd) != (width, height):
                    raise RuntimeError("Window closed, minimized, or resized during the capture")
                c.memset(pixels, 0, size)
                win.require(print_window(hwnd, dc, 0x2), "PrintWindow(PW_RENDERFULLCONTENT)")
                flush()
                frame = c.string_at(pixels, size)
                stamps.append(round(time.perf_counter() - start, 6))
                blank += not nonblank(frame, width, height)
                encoder.stdin.write(frame)
            encoder.stdin.close()
            if encoder.wait(timeout=30):
                raise RuntimeError("FFmpeg failed to encode the window frames")
        if blank == count:
            raise RuntimeError("PrintWindow produced only flat frames; capture is unsupported for this window/state")
        temporary.rename(output)
    finally:
        temporary.unlink(missing_ok=True)
    metadata.write_text(json.dumps(
        {"capture": "PrintWindow PW_RENDERFULLCONTENT", "hwnd": hwnd, "pid": pid,
         "title": title, "width": width, "height": height, "frame_count": count,
         "flat_frames": blank, "nominal_fps": args.fps, "frame_offsets_seconds": stamps,
         "alpha_preserved": False}, indent=2) + "\n", encoding="utf-8")
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", help="Regex for window title")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=5.0)
    parser.add_argument("--fps", type=int, default=12)
    args = parser.parse_args()
    if (not (args.title or args.pid) or args.out.suffix not in (".png", ".mp4")
            or not 0.1 <= args.seconds <= 60 or not 1 <= args.fps <= 30):
        parser.error("Select a window and .png or .mp4 output (0.1–60 s, 1–30 fps)")
    win.dpi_aware()
    capture(args)


if __name__ == "__main__":
    main()

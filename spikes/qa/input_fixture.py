"""Standalone background receiver (or optional layered control), no app hooks."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os

from win32 import WINDOW_PROC, api, dpi_aware, gdi, kernel, require, user

WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0201, 0x0202
WM_MODE = 0x8001
WS_EX_TRANSPARENT, WS_EX_LAYERED = 0x20, 0x80000


class WindowClass(c.Structure):
    _fields_ = [("style", w.UINT), ("proc", WINDOW_PROC),
                ("class_extra", c.c_int), ("window_extra", c.c_int),
                ("module", w.HINSTANCE), ("icon", w.HICON), ("cursor", w.HANDLE),
                ("brush", w.HBRUSH), ("menu", w.LPCWSTR), ("name", w.LPCWSTR)]


class Paint(c.Structure):
    _fields_ = [("dc", w.HDC), ("erase", w.BOOL), ("bounds", w.RECT),
                ("restore", w.BOOL), ("update", w.BOOL), ("reserved", w.BYTE * 32)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", required=True)
    parser.add_argument("--x", type=int, required=True)
    parser.add_argument("--y", type=int, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--layered", action="store_true")
    parser.add_argument("--topmost", action="store_true")
    args = parser.parse_args()
    dpi_aware()
    instance = api(kernel, "GetModuleHandleW", w.HMODULE, w.LPCWSTR)(None)
    default = api(user, "DefWindowProcW", c.c_ssize_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
    get_style = api(user, "GetWindowLongPtrW", c.c_ssize_t, w.HWND, c.c_int)
    set_style = api(user, "SetWindowLongPtrW", c.c_ssize_t, w.HWND, c.c_int, c.c_ssize_t)
    post_quit = api(user, "PostQuitMessage", None, c.c_int)
    module_name = f"LyricsQA-{os.getpid()}"
    log = open(args.log, "w", encoding="utf-8", buffering=1)

    def event(tag, hwnd, **data):
        log.write(json.dumps({"event": tag, "hwnd": hwnd, "pid": os.getpid(), **data}) + "\n")

    @WINDOW_PROC
    def proc(hwnd, msg, wp, lp):
        if msg == 0x000F:  # WM_PAINT: contrasting shape for app-only capture self-test.
            paint = Paint()
            dc = api(user, "BeginPaint", w.HDC, w.HWND, c.POINTER(Paint))(hwnd, c.byref(paint))
            try:
                box = w.RECT(8, 8, min(108, args.width), min(42, args.height))
                white = api(gdi, "GetStockObject", w.HANDLE, c.c_int)(0)
                api(user, "FillRect", c.c_int, w.HDC, c.POINTER(w.RECT), w.HBRUSH)(dc, c.byref(box), white)
            finally:
                api(user, "EndPaint", w.BOOL, w.HWND, c.POINTER(Paint))(hwnd, c.byref(paint))
            return 0
        if msg in (WM_LBUTTONDOWN, WM_LBUTTONUP):
            point = w.POINT(c.c_int16(lp & 0xffff).value, c.c_int16((lp >> 16) & 0xffff).value)
            api(user, "ClientToScreen", w.BOOL, w.HWND, c.POINTER(w.POINT))(hwnd, c.byref(point))
            event("down" if msg == WM_LBUTTONDOWN else "up", hwnd, x=point.x, y=point.y)
            return 0
        if msg == WM_MODE and args.layered:
            style = get_style(hwnd, -20)
            set_style(hwnd, -20, (style | WS_EX_TRANSPARENT) if wp else (style & ~WS_EX_TRANSPARENT))
            event("mode", hwnd, pass_through=bool(get_style(hwnd, -20) & WS_EX_TRANSPARENT))
            return 0
        if msg == WM_DESTROY:
            post_quit(0)
            return 0
        return default(hwnd, msg, wp, lp)

    color = 0x00762722 if not args.layered else 0x003369AC
    brush = api(gdi, "CreateSolidBrush", w.HBRUSH, w.DWORD)(color)
    cursor_icon = api(user, "LoadCursorW", w.HANDLE, w.HINSTANCE, w.HANDLE)(None, 32512)
    wc = WindowClass(0, proc, 0, 0, instance, None, cursor_icon, brush, None, module_name)
    require(api(user, "RegisterClassW", w.ATOM, c.POINTER(WindowClass))(c.byref(wc)), "RegisterClassW")
    create = api(user, "CreateWindowExW", w.HWND, w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD,
                 c.c_int, c.c_int, c.c_int, c.c_int, w.HWND, w.HMENU, w.HINSTANCE, w.LPVOID)
    exstyle = (WS_EX_LAYERED if args.layered else 0) | (0x08 if args.topmost else 0)
    hwnd = require(create(exstyle, module_name, module_name, 0x80000000,
                          args.x, args.y, args.width, args.height,
                          None, None, instance, None), "CreateWindowExW")
    if args.layered:
        require(api(user, "SetLayeredWindowAttributes", w.BOOL, w.HWND, w.DWORD, w.BYTE, w.DWORD)(
            hwnd, 0, 212, 2), "SetLayeredWindowAttributes")
    api(user, "ShowWindow", w.BOOL, w.HWND, c.c_int)(hwnd, 4)
    api(user, "UpdateWindow", w.BOOL, w.HWND)(hwnd)
    event("ready", hwnd)
    msg = w.MSG()
    get_message = api(user, "GetMessageW", c.c_int, c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT)
    translate = api(user, "TranslateMessage", w.BOOL, c.POINTER(w.MSG))
    dispatch = api(user, "DispatchMessageW", c.c_ssize_t, c.POINTER(w.MSG))
    try:
        while True:
            status = get_message(c.byref(msg), None, 0, 0)
            if status == 0:
                break
            require(status != -1, "GetMessageW")
            translate(c.byref(msg))
            dispatch(c.byref(msg))
    finally:
        log.close()


if __name__ == "__main__":
    main()

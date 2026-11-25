"""Win32 helpers shared by the independent desktop QA tools (Windows only)."""
import ctypes as c
from ctypes import wintypes as w
import re
import time

user = c.WinDLL("user32", use_last_error=True)
kernel = c.WinDLL("kernel32", use_last_error=True)
gdi = c.WinDLL("gdi32", use_last_error=True)


def api(lib, name, result, *args):
    func = getattr(lib, name)
    func.restype = result
    func.argtypes = args
    return func


def require(ok, operation):
    if not ok:
        raise OSError(c.get_last_error(), f"{operation} failed")
    return ok


def dpi_aware():
    # Keep window/client bounds and SendInput paths in physical desktop pixels.
    require(api(user, "SetProcessDpiAwarenessContext", w.BOOL, w.HANDLE)(w.HANDLE(-4)),
            "SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)")


WINDOW_PROC = c.WINFUNCTYPE(c.c_ssize_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
ENUM_PROC = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
get_rect = api(user, "GetWindowRect", w.BOOL, w.HWND, c.POINTER(w.RECT))
get_client_rect = api(user, "GetClientRect", w.BOOL, w.HWND, c.POINTER(w.RECT))
client_to_screen = api(user, "ClientToScreen", w.BOOL, w.HWND, c.POINTER(w.POINT))
set_window_pos = api(user, "SetWindowPos", w.BOOL, w.HWND, w.HWND,
                     c.c_int, c.c_int, c.c_int, c.c_int, w.UINT)
post_message = api(user, "PostMessageW", w.BOOL, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
foreground = api(user, "GetForegroundWindow", w.HWND)
set_foreground = api(user, "SetForegroundWindow", w.BOOL, w.HWND)
window_thread = api(user, "GetWindowThreadProcessId", w.DWORD, w.HWND, c.POINTER(w.DWORD))
is_window = api(user, "IsWindow", w.BOOL, w.HWND)
is_iconic = api(user, "IsIconic", w.BOOL, w.HWND)
is_visible = api(user, "IsWindowVisible", w.BOOL, w.HWND)
get_style = api(user, "GetWindowLongPtrW", c.c_ssize_t, w.HWND, c.c_int)


def pid_for(hwnd):
    pid = w.DWORD()
    require(window_thread(hwnd, c.byref(pid)), "GetWindowThreadProcessId")
    return pid.value


def rect(hwnd, client=False):
    r = w.RECT()
    if not client:
        require(get_rect(hwnd, c.byref(r)), "GetWindowRect")
        return r.left, r.top, r.right, r.bottom
    require(get_client_rect(hwnd, c.byref(r)), "GetClientRect")
    tl, br = w.POINT(r.left, r.top), w.POINT(r.right, r.bottom)
    require(client_to_screen(hwnd, c.byref(tl)), "ClientToScreen")
    require(client_to_screen(hwnd, c.byref(br)), "ClientToScreen")
    return tl.x, tl.y, br.x, br.y


def windows(title=None, pid=None):
    """Return visible top-level windows in desktop Z order."""
    visible = api(user, "IsWindowVisible", w.BOOL, w.HWND)
    text = api(user, "GetWindowTextW", c.c_int, w.HWND, w.LPWSTR, c.c_int)
    result = []

    @ENUM_PROC
    def enum(hwnd, _):
        if visible(hwnd):
            buf = c.create_unicode_buffer(512)
            text(hwnd, buf, len(buf))
            owner = pid_for(hwnd)
            if (title is None or re.search(title, buf.value)) and (pid is None or owner == pid):
                result.append((hwnd, owner, buf.value))
        return True

    ret = api(user, "EnumWindows", w.BOOL, ENUM_PROC, w.LPARAM)(enum, 0)
    err = c.get_last_error()
    if not ret and err != 0:
        raise OSError(err, "EnumWindows failed")
    return result


def pick(title, pid):
    matches = windows(title, pid)
    if len(matches) != 1:
        raise ValueError(f"Need exactly one visible window; got {matches!r}. Use list / narrow filters.")
    if is_iconic(matches[0][0]):
        raise ValueError("Target window is minimized; restore it first.")
    return matches[0]


class Mouse(c.Structure):
    _fields_ = [("dx", w.LONG), ("dy", w.LONG), ("data", w.DWORD),
                ("flags", w.DWORD), ("time", w.DWORD), ("extra", c.c_size_t)]


class InputUnion(c.Union):
    class Keyboard(c.Structure):
        _fields_ = [("vk", w.WORD), ("scan", w.WORD), ("flags", w.DWORD),
                    ("time", w.DWORD), ("extra", c.c_size_t)]

    _fields_ = [("mouse", Mouse), ("keyboard", Keyboard)]


class Input(c.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", w.DWORD), ("u", InputUnion)]


def cursor():
    pt = w.POINT()
    require(api(user, "GetCursorPos", w.BOOL, c.POINTER(w.POINT))(c.byref(pt)), "GetCursorPos")
    return pt.x, pt.y


def hit_window(point):
    hwnd = api(user, "WindowFromPoint", w.HWND, w.POINT)(w.POINT(*point))
    top = api(user, "GetAncestor", w.HWND, w.HWND, w.UINT)(hwnd, 2) if hwnd else None
    return {"hit_hwnd": hwnd, "hit_root": top, "hit_pid": pid_for(hwnd) if hwnd else None}


def move(x, y):
    require(api(user, "SetCursorPos", w.BOOL, c.c_int, c.c_int)(x, y), "SetCursorPos")
    if cursor() != (x, y):
        raise RuntimeError(f"Pointer did not reach {(x, y)}; desktop locked or point off-screen")


def send(event):
    require(api(user, "SendInput", w.UINT, w.UINT, c.POINTER(Input), c.c_int)(
        1, c.byref(event), c.sizeof(Input)) == 1, "SendInput")


def button(down):
    event = Input()
    event.mouse.flags = 0x0002 if down else 0x0004
    send(event)


def recovery_shortcut():
    pressed = []

    def key(vk, up):
        event = Input()
        event.type = 1
        event.keyboard.vk = vk
        event.keyboard.flags = 2 if up else 0
        send(event)

    try:
        for vk in (0xA2, 0xA4, 0xA0, 0x4C):  # Ctrl+Alt+Shift+L
            key(vk, False)
            pressed.append(vk)
    finally:
        for vk in reversed(pressed):
            key(vk, True)


def gesture(point, delta=None, settle=0.24, allowed_roots=None):
    move(*point)
    time.sleep(settle)
    hit = hit_window(point)
    if cursor() != point:
        raise RuntimeError("Pointer moved during setup; rerun with exclusive use of the desktop")
    if allowed_roots is not None and hit["hit_root"] not in allowed_roots:
        raise RuntimeError("Pointer target is not an approved test HWND; no button was pressed")
    button(True)
    try:
        if delta:
            for step in range(1, 9):
                move(*(round(coord + dist * step / 8) for coord, dist in zip(point, delta)))
                time.sleep(0.025)
        else:
            time.sleep(0.08)
            if cursor() != point:
                raise RuntimeError("Pointer moved during click; rerun with exclusive use of the desktop")
    finally:
        button(False)
    return hit


def owns_foreground(pid):
    hwnd = foreground()
    return bool(hwnd and pid_for(hwnd) == pid)

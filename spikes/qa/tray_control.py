"""Invoke only a LyricMotion tray icon and validate its native menu before clicking.

Approved exclusive desktop sessions only. No global taskbar/application dump.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import subprocess
import time
import win32gui
import win32process
import win32

PS = r"""
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::RootElement
function Find($parent,$property,$value,$scope) {
  $parent.FindFirst($scope,[System.Windows.Automation.PropertyCondition]::new($property,$value))
}
$children=[System.Windows.Automation.TreeScope]::Children
$desc=[System.Windows.Automation.TreeScope]::Descendants
$class=[System.Windows.Automation.AutomationElement]::ClassNameProperty
$name=[System.Windows.Automation.AutomationElement]::NameProperty
function FindIcon($parent) {
  if(!$parent){return $null}
  $matches=$parent.FindAll($desc,[System.Windows.Automation.PropertyCondition]::new($name,'LyricMotion'))
  foreach($match in $matches) {
    if(!$match.Current.IsOffscreen -and $match.Current.ClassName -eq 'SystemTray.NormalButton') {return $match}
  }
  return $null
}
$tray=Find $root $class 'Shell_TrayWnd' $children
$icon=FindIcon $tray
if(!$icon) {
  $overflow=Find $root $class 'TopLevelWindowForOverflowXamlIsland' $children
  if(!$overflow -or $overflow.Current.IsOffscreen) {
    $button=Find $tray $name 'Show Hidden Icons' $desc
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 200
    $overflow=Find $root $class 'TopLevelWindowForOverflowXamlIsland' $children
  }
  if($overflow) {$icon=FindIcon $overflow}
}
if(!$icon){throw 'No LyricMotion tray icon found'}
$icon.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
"""


def select_menu(action, allowed_pids):
    menus = []
    win32gui.EnumWindows(lambda h, _: menus.append(h) if
        win32process.GetWindowThreadProcessId(h)[1] in allowed_pids and
        win32gui.GetClassName(h) == "#32768" and win32gui.IsWindowVisible(h) else None, None)
    if len(menus) != 1:
        return None
    hwnd = menus[0]
    menu = win32.api(win32.user,"SendMessageW",c.c_ssize_t,w.HWND,w.UINT,w.WPARAM,w.LPARAM)(hwnd,0x1e1,0,0)
    count = win32.api(win32.user,"GetMenuItemCount",c.c_int,w.HMENU)(menu)
    text = win32.api(win32.user,"GetMenuStringW",c.c_int,w.HMENU,w.UINT,w.LPWSTR,c.c_int,w.UINT)
    rect = win32.api(win32.user,"GetMenuItemRect",w.BOOL,w.HWND,w.HMENU,w.UINT,c.POINTER(w.RECT))
    labels, bounds = [], {}
    for i in range(count):
        buf = c.create_unicode_buffer(256)
        text(menu,i,buf,256,0x400)
        labels.append(buf.value)
        box = w.RECT()
        win32.require(rect(None,menu,i,c.byref(box)),"GetMenuItemRect")
        bounds[buf.value] = (box.left,box.top,box.right,box.bottom)
    if labels != ["Open LyricMotion","Show / Hide Overlay","Restore Click-through / Hide","","Quit"]:
        raise RuntimeError("Menu does not match the expected LyricMotion controls")
    b = bounds[action]
    pid = win32.pid_for(hwnd)
    win32.gesture(((b[0]+b[2])//2,(b[1]+b[3])//2),allowed_roots={hwnd})
    return {"action":action,"menu_owner_pid":pid,"labels":labels}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--action",required=True,choices=["Open LyricMotion","Show / Hide Overlay","Restore Click-through / Hide","Quit"])
    p.add_argument("--pids",required=True,type=int,nargs="+")
    args = p.parse_args()
    win32.dpi_aware()
    pointer = win32.cursor()
    try:
        subprocess.run(["powershell.exe","-NoProfile","-NonInteractive","-Command",PS],check=True,timeout=15)
        for _ in range(30):
            result = select_menu(args.action,set(args.pids))
            if result:
                print(json.dumps(result))
                break
            time.sleep(.1)
        else:
            raise RuntimeError("Expected native tray menu did not appear")
    finally:
        win32.move(*pointer)

# Sends one action to the window of the selected Minecraft process.
# Safety: input is sent ONLY if the target window really became the foreground window.
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('look', 'step', 'jump')][string]$Action
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);              // SW_RESTORE
    keybd_event(0x12, 0, 0, UIntPtr.Zero);          // Alt tap: lifts the focus-stealing lock
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return SetForegroundWindow(h);
  }

  // Key by scan code (this is how GLFW/LWJGL reads it).
  public static void Key(ushort vk, bool up) {
    var i = new INPUT { type = 1 };
    i.u.ki.wVk = 0;
    i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
    i.u.ki.dwFlags = 0x0008 | (up ? 0x0002u : 0u);  // SCANCODE [| KEYUP]
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }

  // Relative mouse move (works with a grabbed cursor).
  public static void Move(int dx, int dy) {
    var i = new INPUT { type = 0 };
    i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.dwFlags = 0x0001; // MOUSEEVENTF_MOVE
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

function Fail([string]$msg) { [Console]::Error.WriteLine($msg); exit 1 }

$p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $p) { Fail 'ERR_NO_PROCESS' }
if ($p.ProcessName -notin @('javaw', 'java')) { Fail 'ERR_NOT_JAVA' }
if ($p.MainWindowHandle -eq 0) { Fail 'ERR_NO_WINDOW' }

$target = [IntPtr]$p.MainWindowHandle
$previous = [Native]::GetForegroundWindow()
$W = 0x57; $S = 0x53; $SPACE = 0x20

try {
  [void][Native]::Focus($target)
  Start-Sleep -Milliseconds 200
  if ([Native]::GetForegroundWindow() -ne $target) { Fail 'ERR_NO_FOCUS' }

  switch ($Action) {
    'look' {
      1..6 | ForEach-Object { [Native]::Move(10, 0); Start-Sleep -Milliseconds 25 }
      1..6 | ForEach-Object { [Native]::Move(-10, 0); Start-Sleep -Milliseconds 25 }
    }
    'step' {
      [Native]::Key($W, $false); Start-Sleep -Milliseconds 180; [Native]::Key($W, $true)
      Start-Sleep -Milliseconds 80
      [Native]::Key($S, $false); Start-Sleep -Milliseconds 180; [Native]::Key($S, $true)
    }
    'jump' {
      [Native]::Key($SPACE, $false); Start-Sleep -Milliseconds 80; [Native]::Key($SPACE, $true)
    }
  }
}
finally {
  # Always release the keys and restore the previous window.
  foreach ($k in @($W, $S, $SPACE)) { [Native]::Key($k, $true) }
  if ($previous -ne [IntPtr]::Zero -and $previous -ne $target) { [void][Native]::Focus($previous) }
}

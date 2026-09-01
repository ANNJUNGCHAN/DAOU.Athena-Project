# 지정 PID의 Athena 셸 창만 복원·최상단으로 올린다(다른 인스턴스는 건드리지 않음).
param([Parameter(Mandatory = $true)][int]$ProcessId)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class AthenaFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
}
'@

$proc = Get-Process -Id $ProcessId -ErrorAction Stop
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "PID $ProcessId has no main window." }

# 포그라운드 잠금 우회 — 현재 포그라운드 스레드에 입력 큐를 붙였다 뗀다.
$fg = [AthenaFocus]::GetForegroundWindow()
$fgPid = 0
$fgThread = [AthenaFocus]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$myThread = [AthenaFocus]::GetCurrentThreadId()
[void][AthenaFocus]::AttachThreadInput($myThread, $fgThread, $true)
[void][AthenaFocus]::ShowWindow($hwnd, 9)  # SW_RESTORE
[void][AthenaFocus]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0003) # TOPMOST, NOSIZE|NOMOVE
[void][AthenaFocus]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x0003) # NOTOPMOST (순간 승격 후 해제)
$ok = [AthenaFocus]::SetForegroundWindow($hwnd)
[void][AthenaFocus]::AttachThreadInput($myThread, $fgThread, $false)

Start-Sleep -Milliseconds 400
$now = [AthenaFocus]::GetForegroundWindow()
$nowPid = 0
[void][AthenaFocus]::GetWindowThreadProcessId($now, [ref]$nowPid)
Write-Output "FOCUS_OK=$ok FOREGROUND_PID=$nowPid TARGET_PID=$ProcessId"

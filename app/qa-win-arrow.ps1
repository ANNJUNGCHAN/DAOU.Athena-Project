# QA probe: does Win+Arrow reach the app? (OS-level SendInput, real key path)
# Output: app/captures/qa-win-arrow.json  (ASCII only to stdout to avoid cp949)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinProbe {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<long[]> GetWindowsForPids(HashSet<uint> pids) {
    var result = new List<long[]>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pids.Contains(pid) && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        if (r.R - r.L > 50 && r.B - r.T > 20) result.Add(new long[]{ (long)h, r.L, r.T, r.R - r.L, r.B - r.T });
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
  public static void SendWinArrow(byte arrowVk) {
    keybd_event(0x5B, 0, 0, UIntPtr.Zero);           // LWIN down
    System.Threading.Thread.Sleep(60);
    keybd_event(arrowVk, 0, 0, UIntPtr.Zero);        // arrow down
    System.Threading.Thread.Sleep(60);
    keybd_event(arrowVk, 0, 2, UIntPtr.Zero);        // arrow up
    System.Threading.Thread.Sleep(60);
    keybd_event(0x5B, 0, 2, UIntPtr.Zero);           // LWIN up
  }
}
"@

function Snapshot($pids) {
  $wins = [WinProbe]::GetWindowsForPids($pids)
  $arr = @()
  foreach ($w in $wins) { $arr += ,@{ hwnd = $w[0]; x = $w[1]; y = $w[2]; w = $w[3]; h = $w[4] } }
  return $arr
}

$procs = Get-Process electron -ErrorAction SilentlyContinue
if (-not $procs) { Write-Output "NO_ELECTRON"; exit 1 }
$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($p in $procs) { [void]$pids.Add([uint32]$p.Id) }

$report = [ordered]@{}
$report.before = Snapshot $pids

# focus the chat window: smallest visible height (chat=205-ish; canvas hidden at boot)
$chat = $report.before | Sort-Object { $_.h } | Select-Object -First 1
if (-not $chat) { Write-Output "NO_WINDOW"; exit 1 }

# robust focus: Alt tap unlocks SetForegroundWindow for background processes
function Focus-Window($hwnd) {
  for ($i = 0; $i -lt 5; $i++) {
    [WinProbe]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)   # Alt down
    [WinProbe]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)   # Alt up
    [void][WinProbe]::BringWindowToTop([IntPtr]$hwnd)
    [void][WinProbe]::SetForegroundWindow([IntPtr]$hwnd)
    Start-Sleep -Milliseconds 250
    if ([WinProbe]::GetForegroundWindow() -eq [IntPtr]$hwnd) { return $true }
  }
  return $false
}
$report.focusOk = Focus-Window $chat.hwnd
$report.fgAfterFocus = [long][WinProbe]::GetForegroundWindow()
Start-Sleep -Milliseconds 300

function Step($arrowVk) {
  [WinProbe]::SendWinArrow($arrowVk)
  Start-Sleep -Milliseconds 900
  # dismiss Snap Assist overlay if it appeared, then refocus the app window
  [WinProbe]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
  [WinProbe]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300
  [void](Focus-Window $chat.hwnd)
  Start-Sleep -Milliseconds 300
  return Snapshot $pids
}

$report.afterLeft  = Step 0x25   # Win+Left
$report.afterRight = Step 0x27   # Win+Right
$report.afterUp    = Step 0x26   # Win+Up (maximize -> renderer toggle: chat h 205 -> 789)
$report.afterUp2   = Step 0x26   # Win+Up again (toggle back down expected)
$report.afterDown  = Step 0x28   # Win+Down (minimize both)

# if minimized by mistake, restore all
foreach ($w in [WinProbe]::GetWindowsForPids($pids)) { }
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne 0 -and [WinProbe]::IsIconic($p.MainWindowHandle)) {
    [void][WinProbe]::ShowWindow($p.MainWindowHandle, 9)
  }
}

$json = $report | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("C:\Projects\DAOU.Athena\app\captures\qa-win-arrow.json", $json, [System.Text.Encoding]::UTF8)
Write-Output "DONE"

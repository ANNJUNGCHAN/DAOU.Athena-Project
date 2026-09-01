# Native-resolution capture of the foreground Athena window.
# Read-only with respect to the app: it only reads pixels and writes a PNG to -Out.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$WindowTitle = 'Athena',
  # Several unrelated Electron apps on this machine also title a window "Athena".
  # Pass the shell's root PID to capture exactly the instance under test.
  [int]$ProcessId = 0
)

Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class AthenaCap {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);

  // Returns "hwnd|pid|width|height|title" for every visible top-level window with a title.
  public static List<string> ListWindows() {
    var found = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowTextW(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t.Length == 0) return true;
      int pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      found.Add(h.ToInt64() + "|" + pid + "|" + (r.Right - r.Left) + "|" + (r.Bottom - r.Top) + "|" + t);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

if ($ProcessId -gt 0) {
  $electronPids = @($ProcessId)
} else {
  $electronPids = @(Get-Process -Name electron -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
}
if ($electronPids.Count -eq 0) { throw 'No electron process is running.' }

# Pick the LARGEST visible Athena window, so the 76x76 always-on-top orb never shadows the main shell.
$cand = [AthenaCap]::ListWindows() |
  ForEach-Object {
    $p = $_ -split '\|', 5
    [pscustomobject]@{ Hwnd = [int64]$p[0]; Pid = [int]$p[1]; W = [int]$p[2]; H = [int]$p[3]; Title = $p[4] }
  } |
  Where-Object { $electronPids -contains $_.Pid -and $_.Title -like "$WindowTitle*" -and $_.W -gt 200 -and $_.H -gt 200 } |
  Sort-Object { $_.W * $_.H } -Descending |
  Select-Object -First 1

if (-not $cand) { throw "No Athena window (title '$WindowTitle*', larger than 200x200) found." }

$proc = Get-Process -Id $cand.Pid
$hwnd = [IntPtr]$cand.Hwnd
Write-Output "CAPTURE_TITLE=$($cand.Title)"
[void][AthenaCap]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 400

$rect = New-Object AthenaCap+RECT
if (-not [AthenaCap]::GetWindowRect($hwnd, [ref]$rect)) { throw 'GetWindowRect failed.' }

$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "Bad window rect ${w}x${h}." }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$g.Dispose()

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Out).Hash
$bytes = (Get-Item -LiteralPath $Out).Length
Write-Output "CAPTURE_PATH=$Out"
Write-Output "CAPTURE_PID=$($proc.Id)"
Write-Output "CAPTURE_HWND=$([int64]$hwnd)"
Write-Output "CAPTURE_RECT=$($rect.Left),$($rect.Top),${w}x${h}"
Write-Output "CAPTURE_BYTES=$bytes"
Write-Output "CAPTURE_SHA256=$hash"

param(
  [Parameter(Mandatory = $true)][UInt64]$WindowHandle,
  [Parameter(Mandatory = $true)][int]$StartX,
  [Parameter(Mandatory = $true)][int]$StartY,
  [Parameter(Mandatory = $true)][int]$EndX,
  [Parameter(Mandatory = $true)][int]$EndY,
  [switch]$MoveOnly
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class AthenaSendInputDrag {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint flags;
    public uint time; public UIntPtr extraInfo;
  }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetForegroundWindow(IntPtr window);
  public static IntPtr RequireWindow(ulong raw) {
    if (raw == 0) throw new ArgumentException("Window handle must be non-zero");
    return new IntPtr(unchecked((long)raw));
  }
  public static void Activate(ulong raw) {
    var window = RequireWindow(raw);
    if (!SetForegroundWindow(window))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Could not activate target window");
  }
  public static void Mouse(int dx, int dy, uint flags) {
    var inputs = new INPUT[] {
      new INPUT { type = 0, mouse = new MOUSEINPUT { dx = dx, dy = dy, flags = flags } }
    };
    if (SendInput(1, inputs, Marshal.SizeOf<INPUT>()) != 1)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@

[AthenaSendInputDrag]::Activate($WindowHandle)
Start-Sleep -Milliseconds 100
if (-not [AthenaSendInputDrag]::SetCursorPos($StartX, $StartY)) {
  throw "SetCursorPos failed"
}
Start-Sleep -Milliseconds 100
if (-not $MoveOnly) {
  [AthenaSendInputDrag]::Mouse(0, 0, 0x0002)
  Start-Sleep -Milliseconds 120
}
for ($step = 1; $step -le 12; $step++) {
  $prevX = [Math]::Round($StartX + (($EndX - $StartX) * ($step - 1) / 12))
  $prevY = [Math]::Round($StartY + (($EndY - $StartY) * ($step - 1) / 12))
  $x = [Math]::Round($StartX + (($EndX - $StartX) * $step / 12))
  $y = [Math]::Round($StartY + (($EndY - $StartY) * $step / 12))
  [AthenaSendInputDrag]::Mouse(($x - $prevX), ($y - $prevY), 0x0001)
  Start-Sleep -Milliseconds 24
}
if (-not $MoveOnly) {
  [AthenaSendInputDrag]::Mouse(0, 0, 0x0004)
  Start-Sleep -Milliseconds 120
}

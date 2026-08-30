param(
  [Parameter(Mandatory = $true)][UInt64]$WindowHandle,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class AthenaSendInputClick {
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
  public static void MoveTo(int x, int y) {
    if (!SetCursorPos(x, y))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  public static void Click() {
    var inputs = new INPUT[] {
      new INPUT { type = 0, mouse = new MOUSEINPUT { flags = 0x0002 } },
      new INPUT { type = 0, mouse = new MOUSEINPUT { flags = 0x0004 } }
    };
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>()) != inputs.Length)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@

[AthenaSendInputClick]::Activate($WindowHandle)
Start-Sleep -Milliseconds 100
[AthenaSendInputClick]::MoveTo($X, $Y)
Start-Sleep -Milliseconds 80
[AthenaSendInputClick]::Click()
Start-Sleep -Milliseconds 90
[AthenaSendInputClick]::Click()

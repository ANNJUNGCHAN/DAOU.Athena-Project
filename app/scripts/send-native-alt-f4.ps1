param([Parameter(Mandatory = $true)][UInt64]$WindowHandle)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AthenaNativeAltF4 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
  public static void Send(UInt64 hwnd) {
    var window = new IntPtr(unchecked((long)hwnd));
    BringWindowToTop(window); SetForegroundWindow(window);
    System.Threading.Thread.Sleep(120);
    // WM_SYSCOMMAND / SC_CLOSE is the native window message Windows emits for
    // Alt+F4. Post it to the exact BrowserWindow HWND so no other app can receive it.
    if (!PostMessage(window, 0x0112, new UIntPtr(0xF060), IntPtr.Zero))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
[AthenaNativeAltF4]::Send($WindowHandle)

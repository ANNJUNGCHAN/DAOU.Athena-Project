param(
  [int]$x,
  [int]$y,
  [int]$w,
  [int]$h,
  [string]$out
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap $w, $h
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Write-Output "saved: $out"

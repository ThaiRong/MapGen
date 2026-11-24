Add-Type -AssemblyName System.Drawing
$size = 1024
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::FromArgb(0x1F, 0x21, 0x27))
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0x4F, 0x8C, 0xFF))
$g.FillEllipse($brush, 212, 212, 600, 600)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(0xD7, 0xD9, 0xE0)), 40
$g.DrawEllipse($pen, 212, 212, 600, 600)
$bmp.Save('C:\Users\WinBug\MapGen\src-tauri\app-icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output 'icon saved'

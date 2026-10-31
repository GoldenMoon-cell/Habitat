# 生成「生境」图标：PNG + ICO
#
# 和 Icons.tsx 里的 IconHabitat 严格对应：
#   外环 r=8.6/24，留缺口（环境边界，还在长）
#   内环 r=4.2/24（生态内部结构）
#   中心点 r=1.55/24（生命）
# 青色 #35f0ce，深海底色

Add-Type -AssemblyName System.Drawing

$SIZE = 256
$OUT_DIR = "D:\Habitat_App\build"
New-Item -ItemType Directory -Force -Path $OUT_DIR | Out-Null

$bmp = New-Object System.Drawing.Bitmap($SIZE, $SIZE)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# ── 圆角方块底（先用纯色，渐变那套重载在 PowerShell 里不好构造）──
$inset = 8
$side = $SIZE - 16
$corner = 52

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($inset, $inset, $corner, $corner, 180, 90)
$path.AddArc(($inset + $side - $corner), $inset, $corner, $corner, 270, 90)
$path.AddArc(($inset + $side - $corner), ($inset + $side - $corner), $corner, $corner, 0, 90)
$path.AddArc($inset, ($inset + $side - $corner), $corner, $corner, 90, 90)
$path.CloseFigure()

$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 8, 19, 29))
$g.FillPath($bgBrush, $path)

# 底部加一层更亮的弧，模拟深海透光
$glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 12, 32, 44))
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(-30, 120, 316, 200)
$g.SetClip($path)
$g.FillPath($glowBrush, $glowPath)
$g.ResetClip()

# 边缘极淡青色描边
$edgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(30, 53, 240, 206), 2)
$g.DrawPath($edgePen, $path)

# ── 同心圆（24 网格 → 256 画布，中心 128，缩放 9.2）──
$cx = 128.0
$cy = 128.0
$K = 9.2

$cyan  = [System.Drawing.Color]::FromArgb(255, 53, 240, 206)
$cyanD = [System.Drawing.Color]::FromArgb(115, 53, 240, 206)
$cyanM = [System.Drawing.Color]::FromArgb(180, 53, 240, 206)

function Draw-Ring {
  param($gfx, $centerX, $centerY, $radius, $pen, $startDeg, $sweepDeg)
  $r2 = $radius * 2
  $rectF = New-Object System.Drawing.RectangleF(
    [float]($centerX - $radius),
    [float]($centerY - $radius),
    [float]$r2,
    [float]$r2
  )
  $gfx.DrawArc($pen, $rectF, [float]$startDeg, [float]$sweepDeg)
}

# 外环：r≈79，缺口 85°
$penOuter = New-Object System.Drawing.Pen($cyanD, 6)
$penOuter.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penOuter.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
Draw-Ring -gfx $g -centerX $cx -centerY $cy -radius (8.6 * $K) -pen $penOuter -startDeg 62 -sweepDeg 280

# 内环：r≈39
$penInner = New-Object System.Drawing.Pen($cyanM, 5)
$penInner.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penInner.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
Draw-Ring -gfx $g -centerX $cx -centerY $cy -radius (4.2 * $K) -pen $penInner -startDeg 0 -sweepDeg 360

# 中心点：r≈14
$dotBrush = New-Object System.Drawing.SolidBrush($cyan)
$dotR = 1.55 * $K
$g.FillEllipse($dotBrush, [float]($cx - $dotR), [float]($cy - $dotR), [float]($dotR * 2), [float]($dotR * 2))

$g.Dispose()

# ── 存 PNG ──
$pngPath = Join-Path $OUT_DIR "icon.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "PNG : $pngPath  ($((Get-Item $pngPath).Length) bytes)"

# ── 封 ICO（PNG-in-ICO）──
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoPath = Join-Path $OUT_DIR "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Close()
$fs.Close()
Write-Host "ICO : $icoPath  ($((Get-Item $icoPath).Length) bytes)"

# ── 常用尺寸 ──
foreach ($s in @(32, 64, 128)) {
  $small = New-Object System.Drawing.Bitmap($s, $s)
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.DrawImage($bmp, 0, 0, $s, $s)
  $sg.Dispose()
  $p = Join-Path $OUT_DIR "icon-$s.png"
  $small.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $small.Dispose()
  Write-Host "     $p"
}

$bmp.Dispose()
Write-Host "`n完成。"

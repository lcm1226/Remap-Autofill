$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$browserCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

$browserPath = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browserPath) {
  throw "Chrome or Edge was not found in a standard install location."
}

function Invoke-HeadlessRender {
  param(
    [string]$InputRelativePath,
    [int]$Width,
    [int]$Height,
    [string]$OutputRelativePath
  )

  $inputPath = Join-Path $projectRoot $InputRelativePath
  $outputPath = Join-Path $projectRoot $OutputRelativePath
  $outputDir = Split-Path -Parent $outputPath
  $userDataDir = Join-Path ([System.IO.Path]::GetTempPath()) ("remap-autofill-browser-" + [System.Guid]::NewGuid().ToString("N"))

  if (-not (Test-Path $inputPath)) {
    throw "Missing template: $inputPath"
  }

  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

  if (Test-Path $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
  }

  $url = "file:///" + ($inputPath -replace "\\", "/")
  $args = @(
    "--headless=new",
    "--disable-gpu",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=2000",
    "--force-device-scale-factor=1",
    "--user-data-dir=$userDataDir",
    "--window-size=$Width,$Height",
    "--screenshot=$outputPath",
    $url
  )

  try {
    & $browserPath @args | Out-Null
  }
  finally {
    if (Test-Path $userDataDir) {
      Remove-Item -LiteralPath $userDataDir -Recurse -Force
    }
  }

  if (-not (Test-Path $outputPath)) {
    throw "Failed to generate asset: $outputPath"
  }

  return $outputPath
}

function Resize-Png {
  param(
    [string]$SourcePath,
    [string]$DestinationPath,
    [int]$Size
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $source = [System.Drawing.Image]::FromFile($SourcePath)

  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($source, 0, 0, $Size, $Size)
    $bitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $source.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$jobs = @(
  @{ Input = "store-assets\templates\promo-small.html"; Width = 440; Height = 280; Output = "store-assets\promo\promo-small-440x280.png" },
  @{ Input = "store-assets\templates\screenshot-popup.html"; Width = 1280; Height = 800; Output = "store-assets\screenshots\01-quick-save-popup.png" },
  @{ Input = "store-assets\templates\screenshot-options.html"; Width = 1280; Height = 800; Output = "store-assets\screenshots\02-rules-manager.png" },
  @{ Input = "store-assets\templates\screenshot-gmail.html"; Width = 1280; Height = 800; Output = "store-assets\screenshots\03-gmail-key-remap.png" }
)

$iconSourcePath = Invoke-HeadlessRender -InputRelativePath "store-assets\templates\icon.html" -Width 256 -Height 256 -OutputRelativePath "store-assets\icons\icon-source-256.png"

foreach ($iconSize in 16, 32, 48, 128) {
  Resize-Png -SourcePath $iconSourcePath -DestinationPath (Join-Path $projectRoot ("store-assets\icons\icon-{0}.png" -f $iconSize)) -Size $iconSize
}

Remove-Item -LiteralPath $iconSourcePath -Force

foreach ($job in $jobs) {
  Invoke-HeadlessRender -InputRelativePath $job.Input -Width $job.Width -Height $job.Height -OutputRelativePath $job.Output | Out-Null
}

Get-ChildItem -File (Join-Path $projectRoot "store-assets") -Recurse |
  Where-Object { $_.Extension -eq ".png" } |
  Select-Object FullName, Length

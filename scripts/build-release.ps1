$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json

$version = $manifest.version
$distDir = Join-Path $projectRoot "dist"
$zipPath = Join-Path $distDir ("Remap-Key-Advanced-AutoFill-{0}.zip" -f $version)
$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) ("remap-autofill-" + [System.Guid]::NewGuid().ToString("N"))

$runtimeFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js"
)

try {
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $stageDir "store-assets\\icons") | Out-Null

  foreach ($file in $runtimeFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $stageDir $file)
  }

  Copy-Item -Path (Join-Path $projectRoot "store-assets\\icons\\*.png") -Destination (Join-Path $stageDir "store-assets\\icons")

  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output $zipPath
}
finally {
  if (Test-Path $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}

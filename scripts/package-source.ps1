# Builds a clean public source archive (no node_modules, dist, databases, or secrets).
# Usage: pwsh -File scripts/package-source.ps1

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$outDir = Join-Path $root 'release'
$zipName = 'codememory-source.zip'
$zipPath = Join-Path $outDir $zipName
$staging = Join-Path $outDir 'codememory-source-staging'

$excludeDirs = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@(
    'node_modules', 'dist', 'coverage', 'release', '.git',
    '.cursor', '.vscode', '.idea', '.vercel', '.snowflake', '.v0-trash'
  ),
  [StringComparer]::OrdinalIgnoreCase
)

$excludeFilePatterns = @(
  '*.db', '*.db-shm', '*.db-wal', '.env', '.env.*'
)

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function ShouldExcludeFile([string]$name) {
  foreach ($pat in $excludeFilePatterns) {
    if ($name -like $pat) { return $true }
  }
  return $false
}

Get-ChildItem -Path $root -Force | ForEach-Object {
  if ($excludeDirs.Contains($_.Name)) { return }
  if ($_.Name -eq 'release') { return }

  if ($_.PSIsContainer) {
    Copy-Item $_.FullName (Join-Path $staging $_.Name) -Recurse -Force
  } elseif (-not (ShouldExcludeFile $_.Name)) {
    Copy-Item $_.FullName (Join-Path $staging $_.Name) -Force
  }
}

# Prune excluded directories/files inside the staging tree
Get-ChildItem -Path $staging -Recurse -Directory -Force | ForEach-Object {
  if ($excludeDirs.Contains($_.Name)) {
    Remove-Item $_.FullName -Recurse -Force
  }
}

Get-ChildItem -Path $staging -Recurse -File -Force | ForEach-Object {
  if (ShouldExcludeFile $_.Name) {
    Remove-Item $_.FullName -Force
  }
}

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "Created $zipPath ($sizeMb MB)"

param([ValidateSet('check','build','dev','release')][string]$Mode = 'release')
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Get-Command link.exe -ErrorAction SilentlyContinue) -and (Test-Path $vswhere)) {
    $vs = @(& $vswhere -all -products '*' -property installationPath)
    $vc = $vs | ForEach-Object { Join-Path $_ 'SDK\ScopeCppSDK\vc15\VC' } |
      Where-Object { (Test-Path (Join-Path $_ 'lib\libcmt.lib')) -and (Test-Path (Join-Path $_ 'bin\link.exe')) } |
      Select-Object -First 1
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
    $sdk = Get-ChildItem (Join-Path $kits 'Lib') -Directory | Sort-Object { [version]$_.Name } -Descending |
      Where-Object { (Test-Path (Join-Path $_.FullName 'um\x64\kernel32.lib')) -and
                     (Test-Path (Join-Path $_.FullName 'ucrt\x64\ucrt.lib')) } | Select-Object -First 1
    if ($vc -and $sdk) {
      # Use a locally present MSVC CRT and the Rust toolchain linker. Process environment only.
      $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = 'rust-lld'
      $env:LIB = "$vc\lib;$($sdk.FullName)\um\x64;$($sdk.FullName)\ucrt\x64;$env:LIB"
      $env:INCLUDE = "$vc\include;$kits\Include\$($sdk.Name)\um;$kits\Include\$($sdk.Name)\shared;$kits\Include\$($sdk.Name)\ucrt;$env:INCLUDE"
      $env:PATH = "$vc\bin;$kits\bin\$($sdk.Name)\x64;$env:PATH"
    }
  }
  if ($Mode -eq 'check') { cargo check --manifest-path src-tauri/Cargo.toml }
  elseif ($Mode -eq 'build') { cargo build --manifest-path src-tauri/Cargo.toml }
  elseif ($Mode -eq 'dev') { npm.cmd run tauri -- dev }
  else { npm.cmd run tauri -- build --bundles nsis }
  exit $LASTEXITCODE
} finally { Pop-Location }

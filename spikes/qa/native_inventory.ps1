<#
Read-only inventory, never launches/activates/closes a window or sends input.
Reports only Eonara, its descendants, and minimal WebView matching fields.
No browser command-line dump, app settings, credentials or history.
#>
param(
    [string]$ReleaseRoot = 'C:\D drive\Personal Project\Lyrics',
    [string]$Out
)
$ErrorActionPreference = 'Stop'
$expected = '8d54caab01eb9699db9625d2ad5fb3b8e7f9a70ef45c43eccc5da9cbece98955'
function File-Identity([string]$Path) {
    if (!$Path -or !(Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $file = Get-Item -LiteralPath $Path
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{ path=$file.FullName; bytes=$file.Length; version=$file.VersionInfo.ProductVersion;
        sha256=$hash; matchesMigratedRelease=($hash -eq $expected) }
}
$hosts = @(Get-CimInstance Win32_Process -Filter "Name = 'eonara.exe'")
$webviews = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'")
$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate)
$rows = @($hosts | ForEach-Object {
    $hostPid = $_.ProcessId
    $family = [Collections.Generic.HashSet[uint32]]::new()
    [void]$family.Add($hostPid)
    do {
        $before = $family.Count
        foreach($child in $processes) {
            if($family.Contains([uint32]$child.ParentProcessId)) {
                [void]$family.Add([uint32]$child.ProcessId)
            }
        }
    } while($before -ne $family.Count)
    [ordered]@{
        processId=$hostPid; parentProcessId=$_.ParentProcessId; started=$_.CreationDate;
        file=File-Identity $_.ExecutablePath
        descendantPids=@($family | Sort-Object)
        webviews=@($webviews | Where-Object {$family.Contains([uint32]$_.ProcessId)} | ForEach-Object {
            # Explicit profile paths identify WebView ownership. No other CLI parameters are retained.
            $profile = if($_.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))') {
                if($Matches[1]){$Matches[1]}else{$Matches[2]}
            } else {$null}
            [ordered]@{pid=$_.ProcessId; parent=$_.ParentProcessId; started=$_.CreationDate;
                userDataDir=$profile; version= if($_.ExecutablePath -and (Test-Path -LiteralPath $_.ExecutablePath)) {
                    (Get-Item -LiteralPath $_.ExecutablePath).VersionInfo.ProductVersion
                } else {$null}}
        })
    }
})
$baselineFiles = @('artifacts\v0.3-migrated\lyricmotion.exe',
                  'src-tauri\target\v03-staging\release\lyricmotion.exe',
                  'src-tauri\target\release\eonara.exe')
$result = [ordered]@{
    schemaVersion=1; capturedAt=(Get-Date).ToString('o'); os=[Environment]::OSVersion.VersionString;
    scope='read-only process inventory; does not attest in-memory image or screenshot identity';
    duplicateHosts=($hosts.Count -gt 1);
    hosts=$rows;
    releases=@($baselineFiles | ForEach-Object { File-Identity (Join-Path $ReleaseRoot $_) } | Where-Object {$_});
    note='Disjoint WebView roots are not auto-attributed. Two hosts using one profile can make attribution ambiguous.'
}
$json = $result | ConvertTo-Json -Depth 9
if($Out) {
    if(Test-Path -LiteralPath $Out){throw 'Choose a fresh output file.'}
    $folder=Split-Path -Parent ([IO.Path]::GetFullPath($Out))
    [void][IO.Directory]::CreateDirectory($folder)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Out),$json,[Text.UTF8Encoding]::new($false))
} else { $json }

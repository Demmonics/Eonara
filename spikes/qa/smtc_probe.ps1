param([Parameter(Mandatory=$true)][string]$Title)

# Read only: inspect the specified fixture title; don't select/control any media session.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Use powershell.exe, not pwsh.' }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await-Result($Operation, [type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(5000)) { throw "Timeout waiting for $ResultType" }
    return $task.Result
}

$manager = Await-Result ($managerType::RequestAsync()) $managerType
$match = @(
    foreach ($session in $manager.GetSessions()) {
        if ($session.SourceAppUserModelId -notlike '*powershell.exe*') { continue }
        $properties = Await-Result ($session.TryGetMediaPropertiesAsync()) $propertiesType
        if ($properties.Title -ne $Title) { continue }
        $timeline = $session.GetTimelineProperties()
        @{
            source = $session.SourceAppUserModelId
            title = $properties.Title
            artist = $properties.Artist
            album = $properties.AlbumTitle
            status = [string]$session.GetPlaybackInfo().PlaybackStatus
            position_ms = $timeline.Position.TotalMilliseconds
            duration_ms = $timeline.EndTime.TotalMilliseconds
            last_updated = $timeline.LastUpdatedTime.ToString('o')
            utc = [datetime]::UtcNow.ToString('o')
        }
    }
)
if ($match.Count -eq 0) { exit 3 }
if ($match.Count -ne 1) { throw "Expected exactly one SMTC session matching '$Title'; found $($match.Count)." }
$match[0] | ConvertTo-Json -Compress

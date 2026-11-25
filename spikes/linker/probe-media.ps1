# Demo-independent read-only WinRT feasibility probe. Run in Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSession,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
    Select-Object -First 1
function Await-WinRt($op, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (!$task.Wait(8000)) { throw 'The media API did not return within eight seconds.' }
    $task.Result
}
$manager = Await-WinRt ($managerType::RequestAsync()) $managerType
$sessions = @($manager.GetSessions() | ForEach-Object {
    if ($_.SourceAppUserModelId) {
        $media = Await-WinRt ($_.TryGetMediaPropertiesAsync()) $mediaType
        $timeline = $_.GetTimelineProperties()
        [pscustomobject]@{
            Source = $_.SourceAppUserModelId
            Title = $media.Title
            Artist = $media.Artist
            Status = [string]$_.GetPlaybackInfo().PlaybackStatus
            PositionMs = [math]::Round($timeline.Position.TotalMilliseconds)
            DurationMs = [math]::Round(($timeline.EndTime - $timeline.StartTime).TotalMilliseconds)
            ThumbnailReference = ($null -ne $media.Thumbnail)
        }
    }
})
[pscustomobject]@{ Count = $sessions.Count; Sessions = $sessions } | ConvertTo-Json -Depth 4

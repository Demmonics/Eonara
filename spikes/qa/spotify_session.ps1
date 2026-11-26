param(
    [ValidateSet('inspect','pause','play','seek','next','previous')][string]$Action='inspect',
    [double]$Seconds=0
)
# Authorized QA only: documented GSMTC API, Spotify sources only.
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Desktop'){throw 'Use powershell.exe'}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propsType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op,[type]$type){
    $task=$asTask.MakeGenericMethod($type).Invoke($null,@($op))
    if(!$task.Wait(5000)){throw 'GSMTC operation timed out'}
    $task.Result
}
$manager=Await ($managerType::RequestAsync()) $managerType
$sessions=@($manager.GetSessions() | Where-Object {$_.SourceAppUserModelId -match 'Spotify'})
if($sessions.Count -ne 1){@{available=$false;count=$sessions.Count;action=$Action}|ConvertTo-Json -Compress;exit 3}
$session=$sessions[0]
$ok=$null
switch($Action){
    pause {$ok=Await ($session.TryPauseAsync()) ([bool])}
    play {$ok=Await ($session.TryPlayAsync()) ([bool])}
    seek {
        if($Seconds -lt 0 -or $Seconds -gt 86400){throw 'Invalid seek position'}
        $ok=Await ($session.TryChangePlaybackPositionAsync([long]($Seconds*10000000))) ([bool])
    }
    next {$ok=Await ($session.TrySkipNextAsync()) ([bool])}
    previous {$ok=Await ($session.TrySkipPreviousAsync()) ([bool])}
}
$props=Await ($session.TryGetMediaPropertiesAsync()) $propsType
$timeline=$session.GetTimelineProperties()
$info=$session.GetPlaybackInfo()
@{available=$true;source=$session.SourceAppUserModelId;action=$Action;accepted=$ok;
title=$props.Title;artist=$props.Artist;album=$props.AlbumTitle;thumbnailAvailable=($null -ne $props.Thumbnail);
status=[string]$info.PlaybackStatus;positionMs=$timeline.Position.TotalMilliseconds;
durationMs=$timeline.EndTime.TotalMilliseconds;lastUpdated=$timeline.LastUpdatedTime.ToString('o');
utc=[datetime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress

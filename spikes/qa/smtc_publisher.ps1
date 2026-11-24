param(
    [ValidateRange(4, 600)][int]$HoldSeconds = 45,
    [string]$Title = 'LyricMotion QA Local Track',
    [string]$CommandsFile
)

# Run under Windows PowerShell 5.1, whose .NET Framework supports WinRT projection.
# Generates silent PCM locally; never accesses Spotify, the network, or app internals.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'Use powershell.exe (Windows PowerShell 5.1), not pwsh.'
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Playback.MediaPlayer, Windows.Media.Playback, ContentType=WindowsRuntime]
$null = [Windows.Media.Core.MediaSource, Windows.Media.Core, ContentType=WindowsRuntime]
$null = [Windows.Media.Playback.MediaPlaybackItem, Windows.Media.Playback, ContentType=WindowsRuntime]
$null = [Windows.Media.MediaPlaybackType, Windows.Media, ContentType=WindowsRuntime]
$null = [Windows.Media.SystemMediaTransportControlsTimelineProperties, Windows.Media, ContentType=WindowsRuntime]

$wav = Join-Path ([IO.Path]::GetTempPath()) ("lyrics-qa-{0}.wav" -f ([guid]::NewGuid()))
$player = $null
try {
    $pcm = [byte[]]::new(8000 * 2 * 60)
    $writer = [IO.BinaryWriter]::new([IO.File]::Create($wav))
    try {
        $ascii = [Text.Encoding]::ASCII
        $writer.Write($ascii.GetBytes('RIFF'))
        $writer.Write([int](36 + $pcm.Length))
        $writer.Write($ascii.GetBytes('WAVEfmt '))
        $writer.Write([int]16)
        $writer.Write([int16]1)
        $writer.Write([int16]1)
        $writer.Write([int]8000)
        $writer.Write([int]16000)
        $writer.Write([int16]2)
        $writer.Write([int16]16)
        $writer.Write($ascii.GetBytes('data'))
        $writer.Write([int]$pcm.Length)
        $writer.Write($pcm)
    } finally { $writer.Dispose() }
    $source = [Windows.Media.Core.MediaSource]::CreateFromUri([uri]::new($wav))
    $item = [Windows.Media.Playback.MediaPlaybackItem]::new($source)
    function Set-Metadata([string]$TrackTitle) {
        $properties = $item.GetDisplayProperties()
        $properties.Type = [Windows.Media.MediaPlaybackType]::Music
        $properties.MusicProperties.Title = $TrackTitle
        $properties.MusicProperties.Artist = 'LyricMotion QA'
        $properties.MusicProperties.AlbumTitle = 'Offline SMTC Fixture'
        $item.ApplyDisplayProperties($properties)
    }
    Set-Metadata $Title
    $player = [Windows.Media.Playback.MediaPlayer]::new()
    $player.IsMuted = $true
    $player.IsLoopingEnabled = $true
    $player.Source = $item
    $player.Play()
    @{ event = 'publisher-start'; pid = $PID; title = $Title; utc = [datetime]::UtcNow.ToString('o') } |
        ConvertTo-Json -Compress
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $processed = 0
    $running = $true
    while ($running -and $timer.Elapsed.TotalSeconds -lt $HoldSeconds) {
        if ($CommandsFile -and (Test-Path -LiteralPath $CommandsFile)) {
            $lines = @(Get-Content -LiteralPath $CommandsFile)
            while ($processed -lt $lines.Count) {
                $command = [string]$lines[$processed++]
                switch -Regex ($command) {
                    '^pause$' { $player.Pause() }
                    '^play$' { $player.Play() }
                    '^seek (\d+)$' {
                        $second = [int]$Matches[1]
                        if ($second -gt 59) { throw 'seek must be in 0..59 seconds' }
                        $player.PlaybackSession.Position = [timespan]::FromSeconds($second)
                        # MediaPlayer's default publisher does not announce a paused seek.
                        # Wait for local playback acknowledgement, then publish the measured anchor.
                        $seekTimer = [Diagnostics.Stopwatch]::StartNew()
                        do {
                            Start-Sleep -Milliseconds 25
                            $actual = $player.PlaybackSession.Position
                        } until ([math]::Abs($actual.TotalSeconds - $second) -lt 0.5 -or
                                 $seekTimer.Elapsed.TotalSeconds -ge 2)
                        if ([math]::Abs($actual.TotalSeconds - $second) -ge 0.5) {
                            throw "Playback did not seek to $second"
                        }
                        $timeline = [Windows.Media.SystemMediaTransportControlsTimelineProperties]::new()
                        $timeline.StartTime = [timespan]::Zero
                        $timeline.MinSeekTime = [timespan]::Zero
                        $timeline.Position = $actual
                        $timeline.EndTime = $player.PlaybackSession.NaturalDuration
                        $timeline.MaxSeekTime = $timeline.EndTime
                        $player.SystemMediaTransportControls.UpdateTimelineProperties($timeline)
                    }
                    '^title (.+)$' { Set-Metadata $Matches[1] }
                    '^exit$' { $running = $false }
                    '^$' { continue }
                    default { throw "Unknown command: $command" }
                }
                @{ event = 'command'; command = $command; utc = [datetime]::UtcNow.ToString('o') } |
                    ConvertTo-Json -Compress
            }
        }
        Start-Sleep -Milliseconds 80
    }
} finally {
    if ($null -ne $player) { $player.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
    if (Test-Path -LiteralPath $wav) { Remove-Item -LiteralPath $wav }
}

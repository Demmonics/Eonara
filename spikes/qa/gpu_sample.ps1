param(
    [Parameter(Mandatory=$true)][int[]]$ProcessIds,
    [Parameter(Mandatory=$true)][string]$Out,
    [int]$Samples=35
)
# Windows GPU perf counters, filtered before retention to proven app process IDs.
# Engine counters are not FPS, presentation latency or whole-GPU utilization.
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Out){throw 'Choose a fresh output'}
$rows=[Collections.Generic.List[object]]::new()
$counters=@('\GPU Engine(*)\Utilization Percentage',
            '\GPU Process Memory(*)\Dedicated Usage','\GPU Process Memory(*)\Shared Usage')
Get-Counter -Counter $counters -SampleInterval 1 -MaxSamples $Samples | ForEach-Object {
    $sample=$_
    $values=@($sample.CounterSamples | Where-Object {
        $_.InstanceName -match '^pid_(\d+)_' -and ([int]$Matches[1] -in $ProcessIds)
    } | ForEach-Object {
        @{instance=$_.InstanceName;counter=($_.Path -replace '^.*\\([^\\]+)$','$1');
          value=$_.CookedValue;status=$_.Status}
    })
    $rows.Add(@{utc=$sample.Timestamp.ToUniversalTime().ToString('o');values=$values})
}
$result=@{scope='Windows GPU engine/process-memory perf counters for explicit app PIDs; engine values must not be summed as whole-GPU percent';
    processIds=$ProcessIds;intervalSeconds=1;rows=$rows}
[IO.Directory]::CreateDirectory((Split-Path -Parent ([IO.Path]::GetFullPath($Out))))|Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Out),($result|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))

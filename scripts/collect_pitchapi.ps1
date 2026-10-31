param(
    [switch] $CatalogOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pitchKey = $env:PITCHAPI_API_KEY

if (-not $pitchKey) {
    $envPath = Join-Path $repoRoot '.env'
    if (Test-Path -LiteralPath $envPath) {
        foreach ($line in Get-Content -LiteralPath $envPath) {
            if ($line -match '^\s*PITCHAPI_API_KEY\s*=\s*(.*?)\s*$') {
                $pitchKey = $Matches[1].Trim().Trim('"').Trim("'")
                break
            }
        }
    }
}
if (-not $pitchKey -or $pitchKey -notmatch '^pk_(live|test)_[A-Za-z0-9_-]+$') {
    throw 'Configure PITCHAPI_API_KEY in .env or in the environment.'
}

$headers = @{ 'X-API-KEY' = $pitchKey }
$baseUri = 'https://api.pitchapi.dev/v1'
$dataDir = Join-Path $repoRoot 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

function Get-PitchData([string] $path) {
    try {
        $response = Invoke-RestMethod -Method Get -Uri "$baseUri$path" -Headers $headers -TimeoutSec 30 -ErrorAction Stop
        return @{ ok = $true; data = $response.data; status = 200 }
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
        return @{ ok = $false; data = $null; status = $status }
    }
}

function Write-PitchJson($value, [string] $path) {
    $json = $value | ConvertTo-Json -Depth 100
    if ($json.Contains($pitchKey)) { throw 'Unexpected credential in response; file not written.' }
    $json | Set-Content -LiteralPath $path -Encoding utf8
}

$catalog = Get-PitchData '/leagues'
if (-not $catalog.ok -or -not $catalog.data.leagues) {
    throw "PitchAPI league catalogue request failed (HTTP $($catalog.status))."
}
Write-PitchJson @{ data = $catalog.data } (Join-Path $dataDir 'pitchapi_championnats.json')
Write-Output "Leagues: $(@($catalog.data.leagues).Count)"
if ($CatalogOnly) { return }

$targets = @(
    @{ country = 'FRA'; league = 'Ligue 1' },
    @{ country = 'POR'; league = 'Liga Portugal' },
    @{ country = 'CRO'; league = 'HNL' },
    @{ country = 'ROU'; league = 'Liga I' },
    @{ country = 'LVA'; league = 'Virsliga' },
    @{ country = 'FIN'; league = 'Veikkausliiga' },
    @{ country = 'GER'; league = '3. Liga' },
    @{ country = 'TUR'; league = 'Super Lig' },
    @{ country = 'BEL'; league = 'First Division A' }
)

$records = @()
foreach ($target in $targets) {
    $league = $catalog.data.leagues | Where-Object {
        $_.country_code -eq $target.country -and $_.name -eq $target.league
    } | Select-Object -First 1
    if (-not $league) {
        $records += @{ country = $target.country; league = $target.league; error = 'missing_catalogue' }
        continue
    }
    $seasonMatches = Get-PitchData "/leagues/$($league.id)/matches"
    $match = @($seasonMatches.data.matches | Where-Object { $_.status -eq 'finished' } | Sort-Object time_utc -Descending | Select-Object -First 1)
    if (-not $seasonMatches.ok -or $match.Count -eq 0) {
        $records += @{ country = $target.country; league = $target.league; league_id = $league.id; error = 'no_finished_match'; status = $seasonMatches.status }
        continue
    }
    $match = $match[0]
    $players = Get-PitchData "/matches/$($match.id)/players"
    $shots = Get-PitchData "/matches/$($match.id)/shots"
    $teamStats = Get-PitchData "/matches/$($match.id)/stats"
    $lineups = Get-PitchData "/matches/$($match.id)/lineups"
    $records += @{ country = $target.country; league = $target.league; league_id = $league.id; season = $seasonMatches.data.league.season; match = $match; players = $players; shots = $shots; team_stats = $teamStats; lineups = $lineups }
    $shotCount = @($shots.data.periods | ForEach-Object { $_.shots } | Where-Object { $null -ne $_ }).Count
    Write-Output ("{0} | {1} | {2} | {3} vs {4} | players={5} shots={6} | HTTP players/shots/stats/lineups={7}/{8}/{9}/{10}" -f $target.country, $target.league, $match.date, $match.home_team.name, $match.away_team.name, @($players.data).Count, $shotCount, $players.status, $shots.status, $teamStats.status, $lineups.status)
}

Write-PitchJson @{ retrieved_at_utc = [DateTime]::UtcNow.ToString('o'); samples = $records } (Join-Path $dataDir 'pitchapi_premiers_matchs.json')

# Worklog

- Goal: retain football seasons from 2024/2025 onward and publish the cleaned dataset.
- Scope: remove older season partitions, UEFA editions before 2023/2024 and historical source inventory entries. Preserve current seasons, 2023/2024 UEFA rankings, source archives, player profiles and independently dated FIFA rankings.
- Direction: collection and database builders enforce the 2024 start-year boundary; the dashboard derives available seasons from the canonical index.
- Progress: removed 2021/22–2023/24 match and performance seasons, updated manifests, summaries and documentation; retained archive and table checksums recorded for reproducible verification.
- Verification: season-retention E2E and the dashboard test suite; see dashboard/outputs/season-retention/ for evidence.
- State: verified; publish the data and retention safeguards together.
- Suggested commit: data: retain football seasons from 2024/25 onward.

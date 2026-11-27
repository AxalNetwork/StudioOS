# Selector backtest evidence

| File | Evidence |
| --- | --- |
| `red_main_episodes.json` | D5610-p3: red-main suite episodes from 2026-11-16 22:21 UTC (the first `test-deps` trace) to 2026-11-27 19:00 UTC, each with its first red and parent SHAs, run and job ids, failing test files and the trace artifact the shadow would have read. Ids, SHAs and paths only; `select-tests.mjs --backtest-evidence` downloads the traces, and an episode without them stays explicitly unscored. |

Never replace unavailable failure evidence with an empty passing result.

# The landing bot: switch, caps, sticky comment and App key (D6480)

The landing bot is the set of `landing-*` workflows that act on pull requests as
one GitHub App: the feeder, the branch keeper, the conflict resolver, the
ejection handler, the serial refresh and main repair, plus the label-only
conflict indicator. The workflows, triggers and variables are listed in
[`.github/workflows/README.md` § The landing bot](../../.github/workflows/README.md#the-landing-bot-6480);
the rules each one obeys are in [`scripts/landing-bot/README.md`](../../scripts/landing-bot/README.md);
what a session does about each label is in `AGENTS.md` § "What the landing bot
does to your PR".

**Only the owner changes the switch and the caps.** No session, Session 1
included, sets `LANDING_BOT_ENABLED`, `LANDING_BOT_FEEDER_ENABLED`, `LANDING_AUTO`, `LANDING_CONFLICT_LABELS`
or any cap below. The owner sets `LANDING_BOT_ENABLED=true` only after #6480 is
merged, so that every session can read the rules the bot follows before it
acts on their PRs.

Every variable here is an Actions repository variable: Settings → Secrets and
variables → Actions → Variables. A job reads it when the job starts, so a change
applies from the next run.

## Turn it off

| To stop | Do this | What keeps running |
|---|---|---|
| Every bot but the feeder | Delete `LANDING_BOT_ENABLED`, or set it to anything but `true` or `dispatch`. Then cancel any bot run still in progress on the Actions tab. | The conflict indicator, if `LANDING_CONFLICT_LABELS` is `true`; it only labels. The feeder, if `LANDING_BOT_FEEDER_ENABLED` is set. |
| The feeder | Delete `LANDING_BOT_FEEDER_ENABLED` (its own switch, D6481-p2), or set `LANDING_AUTO` to `false`. | The other bots. |
| Automatic queue entry only | Set `LANDING_AUTO` to `false`. | The other bots. This also stops every agent queueing through the `land-pr` skill. |
| Scheduled runs, keeping manual ones | Set `LANDING_BOT_ENABLED` to `dispatch`. Only a manual run on one named PR then acts. | Nothing on a schedule. |
| Model calls | Set `LANDING_BOT_DAILY_MODEL_RUNS` to `0`. The resolver hands conflicts back; main repair tries a plain revert only. | The no-model keeper, refresh, handler and feeder. |
| One pull request | Add the `bot:off` label to it. | The conflict indicator still labels it. |
| The conflict indicator | Delete `LANDING_CONFLICT_LABELS`. | The bots. |

Disabling a workflow on the Actions tab also stops it, but leaves the variables
saying it is on; prefer the variable, so the state lives in one place.

Turning it off changes nothing already done: merge commits stay on their
branches, queue entries stay queued, labels stay on. Remove an entry from the
queue by hand if it must not land.

## Turn it on

1. Set the caps first (next section). Every unset cap is 0, so a bot turned on
   with no caps does nothing.
2. Rehearse with `LANDING_BOT_ENABLED=dispatch` and one named PR, for example
   `gh workflow run landing-bot-keeper.yml --ref main -f pr=<number>`. Read the
   run's job summary and the PR's sticky comment.
3. Set `LANDING_BOT_ENABLED=true` for the scheduled runs.

The feeder also needs `LANDING_AUTO=true` and passes only when every
`land-pr` gate holds for the PR's exact head, #5500 closed as completed among
them (`scripts/lib/landPr.mjs`).

## Change a cap

Each cap is a whole number; empty, negative or malformed counts as `0`. Daily
caps count from 00:00 UTC, from the reservation artifacts each run uploads
before it acts, so lowering a cap below today's use stops that bot for the rest
of the day.

| Variable | Caps |
|---|---|
| `LANDING_BOT_FEED_PER_SWEEP` | queue entries per feeder run, also bounded by free queue build slots |
| `LANDING_BOT_DAILY_FEEDS` | first queue entries per UTC day |
| `LANDING_BOT_QUEUE_FAIL_BREAKER` | the failed share of the last 20 merge-group runs at which the feeder and the handler stop; a share between 0 and 1, such as `0.20` |
| `LANDING_BOT_KEEPER_PER_SWEEP` | PRs the keeper merges main into per run |
| `LANDING_BOT_QUIET_MIN` | minutes a PR's head must be unchanged before the keeper touches it (unset is 30) |
| `LANDING_BOT_DAILY_PUSHES` | bot pushes per UTC day; for main repair, repair PRs opened today |
| `LANDING_BOT_DAILY_MODEL_RUNS` | model runs per UTC day, one per run whatever its rounds |
| `LANDING_BOT_MAX_CONFLICT_FILES`, `LANDING_BOT_MAX_CONFLICT_LINES` | the largest conflict the resolver sends to a model |
| `LANDING_BOT_DAILY_REQUEUES` | entries the handler restores per UTC day |
| `LANDING_BOT_REFRESH_PER_WINDOW`, `LANDING_BOT_REFRESH_WINDOW_MIN` | PRs the refresh updates per window of that many minutes; both must be set |
| `LANDING_BOT_MAX_QUEUED_RUNS` | queued CI runs above which the refresh stops (`QUEUE_ALERT_IGNORE_BEFORE` drops older runs from the count) |

The per-PR limits are constants, not variables: two attempts per kind for a
PR's life, four bot commits and two model runs per PR in any 24 hours
(`scripts/landing-bot/rules.mjs`), three keeper attempts
(`scripts/landing-bot/keeper-plan.mjs`), two re-queues per PR in 24 hours
(`scripts/landing-bot/ejection-rules.mjs`), one `pr:privileged` PR and three
PRs per slot in the queue (`scripts/landing-bot/concurrency.mjs`). Changing one
is a T2 pull request the owner lands.

## Read the sticky comment

Each bot keeps one comment per PR, starting with the hidden marker
`<!-- landing-bot -->`, and edits it in place. Trust it only when its author is
the App's bot account: a copy written by anyone else is ignored by every bot.

- **Keeper:** one line per attempt, `Keeper attempt k of 3: <outcome>`, earlier
  lines kept, then the detail (conflicted files, or "pull before you push").
  After the third: "That was the last of 3 keeper attempts".
- **A hand-back** (`needs-session`): `Cause:`, `Files:` or `Test:`,
  `Reproduce:` and `Owning slot:`; `Not recorded` where the bot did not know.
- **Resolver:** the resolution diff, after `bot:resolved`.
- **Ejection handler:** the class of the ejection and each reason it waits or
  hands back. A sweep whose outcome did not change writes nothing.

The comment is a display. The attempt limits are counted from the App's commits
and the bot workflow runs, which a session cannot rewrite. The keeper's
three-attempt cap takes the larger of the App's label events and commits, and
the comment's attempt lines, so deleting lines cannot lower it. Each run's job
summary on the Actions tab carries the same decision with every skipped PR and
its reasons.

## Rotate the App key

The App's ID and private key are the `LANDING_BOT_APP_ID` and
`LANDING_BOT_APP_PRIVATE_KEY` secrets of the `landing-bot` environment, set
to accept deployments from `main` only (`scripts/landing-bot/README.md`). Every job that writes as the App mints a
short-lived installation token from them.

1. In the App's settings on GitHub, generate a new private key.
2. Replace `LANDING_BOT_APP_PRIVATE_KEY` in the `landing-bot` environment with
   it.
3. Check the next run of any bot workflow: its "installation token" step
   succeeds. With the bot off, there is no run to check until it is turned on.
4. Delete the old key in the App's settings.

If the App itself is replaced, also change `LANDING_BOT_APP_ID` and the
`LANDING_BOT_LOGIN` variable (`<new slug>[bot]`). The old App's commits and
queue entries then no longer count as the bot's: the feeder holds PRs carrying
them, and the handler no longer treats the old App's queue entries as consent.

The model keys are separate, in the `repair` environment (`ANTHROPIC_API_KEY`,
`ANTHROPIC_API_KEY_2`, `ANTHROPIC_API_KEY_3`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`); rotate each there. Never paste a key into an issue, a PR or a
comment: the repository is public.

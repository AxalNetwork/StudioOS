# Private bot host

`index.ts` exports `MeetingBotContainer` and refuses all public HTTP requests.
`container.ts` owns one container per run, funded lease alarms and persistent
Stop tombstones. Long boot/HTTP commands run outside short state locks.
#3708: `/diagnose` starts one owner diagnostic per instance (an 8-minute lease,
no heartbeat), sharing the run's `boot`; `GET /health` also answers the
deployed commit (`MEETING_BOT_VERSION`, set by `meeting-bot-deploy.yml`).
Only the site's cross-script Durable Object binding reaches this host.

The host bundles shared run-key/command helpers from the Worker services;
no database, member content or provider credential store is bound here.
Deployment uses the root `wrangler.meeting-bot.toml`, independently of the
site. Runtime image contents are explicitly allowlisted by the Dockerfile;
this host directory is not copied into the running image.

D5153 (#5153): `/start` answers with a startup fact, `{ok, code, stage,
runtime_version}`. Before the signed command it waits for the runtime's
`/healthz` (`ready: true`, and the host's own build when the runtime reports
one), and it names the boundary a start stopped at: `image_unavailable`,
`container_start_failed`, `runtime_no_answer`, `runtime_process_exited`,
`runtime_health_failed`, `runtime_refused` or `runtime_command_timeout`. One
`meeting_bot.runtime_stage` log line per transition, with codes only. The
vocabulary and the time budgets live in
`cloudflare-worker/src/services/meetingBotStartup.ts`.

D5675: `previewCanary.ts` owns the disabled, authenticated synthetic preview startup/callback gate and ten-minute metadata cleanup; it never starts a meeting.

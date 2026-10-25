# Private bot host

`index.ts` exports `MeetingBotContainer` and refuses all public HTTP requests.
`container.ts` owns one container per run, funded lease alarms and persistent
Stop tombstones. Long boot/HTTP commands run outside short state locks.
Only the site's cross-script Durable Object binding reaches this host.

The host bundles shared run-key/command helpers from the Worker services;
no database, member content or provider credential store is bound here.
Deployment uses the root `wrangler.meeting-bot.toml`, independently of the
site. Runtime image contents are explicitly allowlisted by the Dockerfile;
this host directory is not copied into the running image.

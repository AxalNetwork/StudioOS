# Independent archive observer (D5676)

This disabled candidate receives metadata from the tail writer and checks known objects/markers independently. It never calls the studioos producer, sends Slack, reads archive bodies or attaches a tail consumer. Its metadata database is separate from customer data. No resource ID, live binding, credential or production activation is included.

- `src/` contains the receiver and independent metadata checks.
- `migrations/` contains the observer's own metadata schema; it is not a main application migration.

The candidate config is `wrangler.jsonc`. Owner approval/provisioning must supply the isolated metadata DB, archive-head access, three separate role keys and external watcher before enabling it. The shared sender and its destination registry remain #5665/#5671/#5668. See D5676 for cost bounds, known loss/replay limits, private retention review and rollback. Add only content-free receipts here; raw events and exact keys never enter a delivery receipt.

## Owner setup

1. Provision the observer's separate metadata D1 database and configure its
   binding in this directory's Wrangler config. Set that binding's
   `migrations_dir` to `migrations`. Keep the observer runtime off during setup.
2. Verify the database name and ID belong to the observer, then apply its
   migrations explicitly. Pass the observer database name in place of
   `OBSERVER_DATABASE`.

   ```sh
   cloudflare-worker/node_modules/.bin/wrangler d1 migrations apply OBSERVER_DATABASE --remote --config cloudflare-archive-observer/wrangler.jsonc
   ```

3. Set `ARCHIVE_OBSERVER_CLOUDFLARE_API_TOKEN` to the separate deploy
   credential and use the repository's `CLOUDFLARE_ACCOUNT_ID` secret.
4. Set the repository variable `ARCHIVE_OBSERVER_DEPLOY_ENABLED` to `true`
   and dispatch **Archive observer deploy** from main. The job type-checks
   and dry-runs packaging before it deploys. Runtime activation is tracked
   separately in #5676.

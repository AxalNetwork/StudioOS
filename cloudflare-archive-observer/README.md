# Independent archive observer (D5676)

This disabled candidate receives metadata from the tail writer and checks known objects/markers independently. It never calls the studioos producer, sends Slack, reads archive bodies or attaches a tail consumer. Its metadata database is separate from customer data. No resource ID, live binding, credential or production activation is included.

- `src/` contains the receiver and independent metadata checks.
- `migrations/` contains the observer's own metadata schema; it is not a main application migration.

The candidate config is `wrangler.jsonc`. Owner approval/provisioning must supply the isolated metadata DB, archive-head access, three separate role keys and external watcher before enabling it. The shared sender and its destination registry remain #5665/#5671/#5668. See D5676 for cost bounds, known loss/replay limits, private retention review and rollback. Add only content-free receipts here; raw events and exact keys never enter a delivery receipt.

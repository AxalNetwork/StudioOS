### Events desk fixes (D1115, #2995)

`/admin/events/all` and `/admin/events/calendar` use every enriched D918 list
page, without capped analytics or Guard G. `/admin/events/:id` uses its own
registrations summary for the first tiles and capacity dialog. All events adds
Waiting time (longest first, unknown last); Review adds Your time below the
event-zone facts. Unpublish/Cancel conflicts have their own sentences.

The existing authenticated `POST /api/events` and `PATCH /api/events/:id`
convert supplied local clock inputs in the event’s selected zone into UTC,
refusing invalid zones/dates and DST gaps/folds. Explicit-offset instants retain
their meaning; legacy rows are not shifted. The host editor displays the same
zone and preserves an unchanged instant. No route or migration is added.


-- D4703 (#4703) part 2: a subscription amount records when Stripe created the
-- event that set it, so an older event delivered late cannot overwrite a newer
-- amount. Stripe does not deliver webhooks in order.
--
-- NULL on existing rows: the first event after this migration sets it, and an
-- event that carries no `created` (none does in practice) writes as before.
ALTER TABLE member_subscription_amounts ADD COLUMN event_created INTEGER;

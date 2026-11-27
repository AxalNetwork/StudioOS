-- D4809 (#4809): how the cohort NDA's last send went, on the grant it was sent for.
--
-- `nda_delivery` is 'delivered' when the envelope was created and its signing
-- email went, 'failed' when the envelope could not be created or its email did
-- not go. NULL: never sent. `nda_delivery_at` is when that last attempt ran.
-- A failed send is recovered from the same grant: Send NDA again (the routes
-- void a still-open envelope first, so two are never out at once).
ALTER TABLE investor_cohort_access ADD COLUMN nda_delivery TEXT;
ALTER TABLE investor_cohort_access ADD COLUMN nda_delivery_at TEXT;

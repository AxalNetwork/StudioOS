-- D6706 (#6706): the forward fix for 202611270510_6706_formation_case_documents.sql.
-- The migration's columns, unique index and envelope table are inert for a Worker from before it: that Worker
-- never writes origin = 'generated' rows (the only rows the index covers) and never reads the new table. The
-- consent-to-act trigger is not inert: a rolled-back Worker cannot record a consent, so it could never move an
-- incorporation filing from prepared to submitted. Recovery drops that trigger, so the older Worker's filing flow
-- works again; the Worker that ships with the migration refuses without consent on its own (formationFilings.ts).
-- Idempotent, and it deletes no row.
DROP TRIGGER IF EXISTS trg_formation_filing_consent_to_act;

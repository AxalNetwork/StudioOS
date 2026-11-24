/** D5829: per-form counts must not collapse answers, history or venture boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { typeformReviewCounts } from '../src/services/typeform/reviewCounts.ts';

test('per-form counts separate completed responses, multiple matching questions and reviewed signals across form history and ventures', async () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db);
  db.exec(`INSERT INTO projects (id, name) VALUES (41, 'Synthetic venture'), (42, 'Other synthetic venture');
    INSERT INTO integrations (id, uid, user_id, provider_key, auth_type) VALUES (501, 'count-source', 7, 'typeform', 'oauth2');
    INSERT INTO typeform_form_syncs (id, integration_id, project_id, form_id, sync_state) VALUES
      (1,501,41,'FormA','ok'), (2,501,41,'FormB','never'), (3,501,42,'OtherForm','ok');
    INSERT INTO typeform_responses (id, sync_id, response_id, response_type, first_seen_at, last_seen_at) VALUES
      (1,1,'response1','completed','2026-11-19','2026-11-19'),
      (2,2,'response2','partial','2026-11-19','2026-11-19'),
      (3,3,'response3','completed','2026-11-19','2026-11-19');
    INSERT INTO typeform_field_mappings (id,sync_id,field_id,field_type,kind,rule_json) VALUES
      (1,1,'q1','long_text','need_to_have','{}'), (2,1,'q2','long_text','need_to_have','{}'), (3,3,'q3','long_text','need_to_have','{}');
    INSERT INTO typeform_answers (id,response_row_id,mapping_id,field_id,created_at) VALUES
      (1,1,1,'q1','2026-11-19'), (2,1,2,'q2','2026-11-19'), (3,3,3,'q3','2026-11-19');
    INSERT INTO demand_signals (id,project_id,kind,signal_date,status,source_kind) VALUES
      (1,41,'need_to_have','2026-11-19','confirmed','typeform'), (2,41,'need_to_have','2026-11-19','to_confirm','typeform');
    INSERT INTO typeform_reviews (project_id,integration_id,source_key,evidence_mapping_id,mapping_version,answer_id,signal_id,status) VALUES
      (41,501,'count-a',1,1,1,1,'confirmed'), (41,501,'count-b',2,1,2,2,'pending');`);
  const env: any = { DB: d1Over(db) };
  const rows = await typeformReviewCounts(env, 41, 501);
  assert.deepEqual(rows.map(r => ({ ...r })), [
    { form_id: 'FormA', sync_state: 'ok', completed: 1, matching_answers: 2, confirmed_signals: 1 },
    { form_id: 'FormB', sync_state: 'never', completed: 0, matching_answers: 0, confirmed_signals: 0 },
  ]);
  db.close();
});

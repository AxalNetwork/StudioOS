/**
 * #6110 (D6110) — Team expansion: a row's Move to… opens on its own applicant.
 *
 * The Worker declares one `move-applicant` form (Applicant, Move to), and each applicant's row on the Shortlist
 * names it with its own `{ application_id }`. A row's action carries that body; `recordFormFor` starts the field the
 * body names on its value, and `recordActionBody` sends it with the chosen stage. Mutation checked: the prefill
 * dropped (the form opens on no applicant, fails); the body dropped from the sent values (fails).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/applicant_stages_6110.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { declaredActions, recordActionBody, recordFormFor, rowAction } from '../src/pages/cycles/recordModel.js';

const MOVE = {
  key: 'move-applicant', label: 'Move to…', kind: 'form',
  form: { title: 'Move an applicant', cta: 'Move', fields: [
    { key: 'application_id', label: 'Applicant', kind: 'CH', required: true, options: [{ value: '41', label: 'Lena Park · Interview' }, { value: '43', label: 'Sol Ito · Offer' }] },
    { key: 'stage', label: 'Move to', kind: 'CH', required: true, options: [{ value: 'hired', label: 'Hired' }] },
  ] },
};
const RECORD = { id: '31', actions: [MOVE], main: [{ key: 'shortlist', rows: [{ a: 'Lena Park', c: 'Interview', action: { key: 'move-applicant', body: { application_id: 41 } } }] }], side: [] };

test('#6110 a row’s Move to… opens on that row’s applicant and sends it with the stage', () => {
  const declarations = declaredActions(RECORD);
  const fromRow = rowAction(RECORD.main[0].rows[0].action, declarations);
  assert.deepEqual(fromRow.body, { application_id: 41 });
  const spec = recordFormFor(fromRow, RECORD, null);
  assert.equal(spec.current.application_id, '41', 'the applicant field starts on the row’s applicant, as a choice holds it');
  assert.deepEqual(recordActionBody(fromRow, { ...spec.current, stage: 'hired' }), { application_id: '41', stage: 'hired' });
  // From the record's own action row there is no body: the form opens with no applicant chosen.
  const fromHeader = rowAction('move-applicant', declarations);
  assert.equal(Object.hasOwn(recordFormFor(fromHeader, RECORD, null).current, 'application_id'), false);
});

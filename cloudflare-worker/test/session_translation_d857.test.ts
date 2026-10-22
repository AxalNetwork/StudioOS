/**
 * D857 (#2502) — Record a Session translates: chat text and voice transcripts
 * into the founder's working language, keeping the original.
 *
 * Covers detection, translation (stubbed Workers AI), the skip for the working
 * language, failure and retry, structuring reading the translation with quotes
 * keeping both texts, the session page showing both, the consent gate, and the
 * AI token hold and settle on the ledger.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/session_translation_d857.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_FIXTURE_PLANS, aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { createJWT } from '../src/auth.ts';
import structure from '../src/routes/founder_validate_structure.ts';
import sessionsApp from '../src/routes/founder_validate_sessions.ts';
import { moduleSuggestions } from '../src/services/interviewSuggestions.ts';
import { structureSession } from '../src/services/sessionAutoStructure.ts';
import {
  detectByScript, modelFor, primaryLang, translateSession, workingLanguage, MAX_ATTEMPTS, TRANSLATION_MODEL,
} from '../src/services/sessionTranslation.ts';
import { INDIC_TRANSLATION_MODEL } from '../src/services/ai/shapes.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, FOUNDER = 9, PROJECT = 7, IV = 101, SESSION = 5;
const MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SMALL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

// A Spanish chat message, a French voice note's transcript, and an English line.
const ES = 'Lo hacemos a mano cada viernes y lo odiamos.';
const FR = 'Nous avons essayé Ledgerly mais c\'était trop cher.';
const EN = 'If it worked I would pay for it tomorrow.';
const PHRASEBOOK: Record<string, string> = {
  [ES]: 'We do it by hand every Friday and we hate it.',
  [FR]: 'We tried Ledgerly but it was too expensive.',
};

function world(reply: (model: string, input: any) => any) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${ME}', ${ME});
    CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, timezone TEXT DEFAULT 'UTC', locale TEXT DEFAULT 'en');
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    INSERT INTO projects VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}, NULL);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${IV}, ${PROJECT}, 'Ana');
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '452_record_session_setup.sql', '453_interview_processing.sql',
    // The migration under test, whole: the segment columns and the working-language setting.
    '527_session_translation.sql']) db.exec(mig(m));
  applyEngineSchema(db);
  db.prepare('UPDATE discovery_interviews SET quote_consent = 1 WHERE id = ?').run(IV);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (41, ${PROJECT}, 'Manual reconciliation')`);
  db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
              VALUES (?, 'sess-5', ?, ?, ?, 'video', 'transcribed', 'given')`).run(SESSION, IV, PROJECT, ME);
  const seg = db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text, model)
                          VALUES (?, 'final', ?, ?, '[Interviewee]', ?, ?)`);
  seg.run(SESSION, 0, 4000, ES, null);            // a chat message
  seg.run(SESSION, 4000, 8000, FR, 'whisper');    // a voice note's transcript
  seg.run(SESSION, 8000, 12000, EN, null);
  const calls: Array<{ model: string; input: any }> = [];
  const env: any = {
    JWT_SECRET, ENVIRONMENT: 'development', DB,
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        calls.push({ model, input });
        return reply(model, input);
      },
    },
  };
  return { env, db, calls };
}

/** m2m100 from the phrasebook; the structuring model quotes whatever text it was shown. */
function translator(opts: { failTranslation?: boolean } = {}) {
  return (model: string, input: any) => {
    if (model === TRANSLATION_MODEL) {
      if (opts.failTranslation) throw new Error('upstream 503');
      return { translated_text: PHRASEBOOK[input.text] ?? `[en] ${input.text}` };
    }
    if (model === INDIC_TRANSLATION_MODEL) return { translations: [`[${input.target_language}] ${input.text}`] };
    const shown = String(input.messages?.at(-1)?.content ?? '');
    const pain = shown.includes(PHRASEBOOK[ES]) ? PHRASEBOOK[ES] : ES;
    const rival = shown.includes(PHRASEBOOK[FR]) ? PHRASEBOOK[FR] : FR;
    return { response: JSON.stringify({ placements: [
      { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' }, cite: { from: 0, to: 4000 }, quote: pain },
      { kind: 'competitor_mention', payload: { name: 'Ledgerly' }, cite: { from: 4000, to: 8000 }, quote: rival },
    ] }) };
  };
}

async function call(env: any, app: any, method: string, path: string) {
  const token = await createJWT(env, ME, `u${ME}@example.test`, 'founder', undefined, `jti-${ME}`);
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, env);
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const segments = (db: any) => db.prepare(
  `SELECT id, text, source_lang, translated_text, translated_lang, translation_model, translation_reservation_uid,
          translation_status, translation_attempts FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY start_ms`,
).all(SESSION);
const translateCalls = (calls: Array<{ model: string }>) => calls.filter((c) => c.model === TRANSLATION_MODEL || c.model === INDIC_TRANSLATION_MODEL);

// ── Detection ───────────────────────────────────────────────────────────────

test('detection: the script decides most passages, Latin text by its words, and only a contest is ambiguous', () => {
  assert.deepEqual(detectByScript(ES), { lang: 'es', ambiguous: false });
  assert.deepEqual(detectByScript(FR), { lang: 'fr', ambiguous: false });
  assert.deepEqual(detectByScript(EN), { lang: 'en', ambiguous: false });
  assert.equal(detectByScript('Мы делаем это вручную каждую пятницу').lang, 'ru');
  assert.equal(detectByScript('Ми робимо це вручну щоп\'ятниці і ненавидимо її').lang, 'uk');
  assert.equal(detectByScript('हम हर शुक्रवार इसे हाथ से करते हैं').lang, 'hi');
  assert.equal(detectByScript('毎週金曜日に手作業でやっています').lang, 'ja');
  assert.equal(detectByScript('我们每周五手工完成').lang, 'zh');
  assert.equal(detectByScript('نحن نفعل ذلك يدويا').lang, 'ar');
  // Short Latin text no language claims is read as the working language, with no call.
  assert.deepEqual(detectByScript('ok, Friday', 'en'), { lang: 'en', ambiguous: false });
  // Another language competing with no clear winner is the one case for the model.
  assert.deepEqual(detectByScript('la vida', 'en'), { lang: null, ambiguous: true });
  assert.deepEqual(detectByScript('12 345 !!', 'en'), { lang: null, ambiguous: false }, 'no letters, nothing to place');
});

test('the working language is the member\'s setting, else the account\'s language, else English (Q1, A)', async () => {
  const { env, db } = world(translator());
  assert.equal(await workingLanguage(env, ME), 'en', 'no settings row');
  db.prepare("INSERT INTO user_settings (user_id, locale) VALUES (?, 'pt-BR')").run(ME);
  assert.equal(await workingLanguage(env, ME), 'pt', 'the account\'s language');
  db.prepare("UPDATE user_settings SET validate_working_lang = 'fr' WHERE user_id = ?").run(ME);
  assert.equal(await workingLanguage(env, ME), 'fr', 'the member\'s own setting');
  db.prepare("UPDATE user_settings SET validate_working_lang = 'not a language', locale = '' WHERE user_id = ?").run(ME);
  assert.equal(await workingLanguage(env, ME), 'en');
  assert.deepEqual([primaryLang('EN-gb'), primaryLang('x'), primaryLang(null)], ['en', null, null]);
});

test('IndicTrans2 only for English into an Indic language; m2m100 for every other pair', () => {
  assert.equal(modelFor('en', 'hi'), INDIC_TRANSLATION_MODEL);
  assert.equal(modelFor('en', 'ta'), INDIC_TRANSLATION_MODEL);
  assert.equal(modelFor('hi', 'en'), TRANSLATION_MODEL, 'IndicTrans2 does not translate into English');
  assert.equal(modelFor('es', 'en'), TRANSLATION_MODEL);
});

// ── A Spanish chat and a French voice note become English ──────────────────

test('a Spanish chat and a French voice note become English segments, the originals kept; English is not translated', async () => {
  const { env, db, calls } = world(translator());
  const pass = await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.deepEqual(pass, { translated: 2, same: 1, pending: 0, undetected: 0, stopped: null });
  const [es, fr, en] = segments(db);
  assert.deepEqual([es.text, fr.text, en.text], [ES, FR, EN], 'the originals are untouched');
  assert.deepEqual([es.source_lang, fr.source_lang, en.source_lang], ['es', 'fr', 'en']);
  assert.deepEqual([es.translation_status, fr.translation_status, en.translation_status], ['done', 'done', 'same']);
  assert.deepEqual([es.translated_lang, fr.translated_lang, en.translated_lang], ['en', 'en', null]);
  assert.equal(es.translation_model, TRANSLATION_MODEL);
  // Encrypted at rest: neither language reads in the column.
  for (const s of [es, fr]) {
    assert.ok(s.translated_text && !s.translated_text.includes('Friday') && !s.translated_text.includes('Ledgerly'), 'ciphertext only');
  }
  // One translation call per foreign segment, none for English, and each names its pair.
  assert.deepEqual(translateCalls(calls).map((c: any) => [c.input.text, c.input.source_lang, c.input.target_lang]), [[ES, 'es', 'en'], [FR, 'fr', 'en']]);
  assert.equal(en.translated_text, null);
  // A second pass translates nothing again.
  const again = await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.deepEqual(again, { translated: 0, same: 0, pending: 0, undetected: 0, stopped: null });
  assert.equal(translateCalls(calls).length, 2);
});

test('the charges are on the ledger and in ai_usage_logs, each segment naming its hold', async () => {
  const { env, db } = world(translator());
  await translateSession(env, { sessionId: SESSION, userId: ME });
  const logs = db.prepare("SELECT task, model, charged_microusd, reservation_uid, surface FROM ai_usage_logs WHERE task = 'translate_segment' ORDER BY id").all();
  assert.equal(logs.length, 2);
  for (const l of logs) {
    assert.equal(l.model, TRANSLATION_MODEL);
    assert.ok(Number.isInteger(l.charged_microusd) && l.charged_microusd >= 0, 'settled, a known amount');
    assert.ok(l.reservation_uid, 'held on the ledger');
    assert.equal(l.surface, '/validate/customer-research');
  }
  const held = db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE uid IN (SELECT reservation_uid FROM ai_usage_logs WHERE task = ?)').get('translate_segment');
  assert.equal(held.n, 2, 'each translation\'s hold is a ledger row');
  const [es, fr] = segments(db);
  assert.deepEqual([es.translation_reservation_uid, fr.translation_reservation_uid].sort(), logs.map((l: any) => l.reservation_uid).sort());
});

// ── Structuring reads the translation; quotes keep both ─────────────────────

test('structuring reads the translation, and each quote keeps the customer\'s own words and language beside it', async () => {
  const { env, db, calls } = world(translator());
  const r = await call(env, structure, 'POST', `/sessions/${SESSION}/structure`);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const shown = calls.filter((c) => c.model === MID).map((c) => String(c.input.messages.at(-1).content)).join('\n');
  assert.ok(shown.includes(PHRASEBOOK[ES]) && shown.includes(PHRASEBOOK[FR]), 'the model read the translations');
  assert.ok(!shown.includes(ES) && !shown.includes(FR), 'and not the originals');
  assert.ok(shown.includes(EN));
  const rows = db.prepare('SELECT kind, citation_json FROM validate_proposals WHERE session_id = ? ORDER BY id').all(SESSION);
  const cites = Object.fromEntries(rows.map((x: any) => [x.kind, JSON.parse(x.citation_json)]));
  assert.deepEqual([cites.pain_severity.quote, cites.pain_severity.quote_original, cites.pain_severity.source_lang], [PHRASEBOOK[ES], ES, 'es']);
  assert.deepEqual([cites.competitor_mention.quote, cites.competitor_mention.quote_original, cites.competitor_mention.source_lang], [PHRASEBOOK[FR], FR, 'fr']);
  // The module's suggestions carry both texts and the language (the interview agreed to be quoted).
  const pains = await moduleSuggestions(env, PROJECT, 'problem-discovery');
  assert.deepEqual(pains.map((s) => [s.quote, s.quote_original, s.source_lang]), [[PHRASEBOOK[ES], ES, 'es']]);
  // Without that consent, both are withheld alike.
  db.prepare('UPDATE discovery_interviews SET quote_consent = 0 WHERE id = ?').run(IV);
  const withheld = (await moduleSuggestions(env, PROJECT, 'problem-discovery'))[0];
  assert.equal(withheld.quote, withheld.quote_original);
  assert.notEqual(withheld.quote_original, ES);
});

test('the session page shows each segment\'s own words and, beside them, its translation', async () => {
  const { env } = world(translator());
  await translateSession(env, { sessionId: SESSION, userId: ME });
  const r = await call(env, sessionsApp, 'GET', `/sessions/${SESSION}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const finals = r.json.segments.filter((s: any) => s.source === 'final');
  assert.deepEqual(finals.map((s: any) => [s.text, s.translation, s.source_lang, s.translation_status]), [
    [ES, PHRASEBOOK[ES], 'es', 'done'], [FR, PHRASEBOOK[FR], 'fr', 'done'], [EN, null, 'en', 'same'],
  ]);
  assert.ok(finals.every((s: any) => !('translated_text' in s)), 'the ciphertext never leaves the Worker');
});

// ── Failure and retry ───────────────────────────────────────────────────────

test('a refused translation (no AI tokens) leaves the original usable, marks it pending, and the next pass retries it', async () => {
  const { env, db, calls } = world(translator());
  setFixtureAllowance(db, 0);
  const pass = await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.equal(pass.translated, 0);
  assert.equal(pass.pending, 1, 'the first refusal ends the pass: every other segment would be refused too');
  assert.ok(pass.stopped, 'stopped on the ledger\'s refusal');
  assert.equal(translateCalls(calls).length, 0, 'refused before any model ran');
  const [es, fr, en] = segments(db);
  assert.deepEqual([es.translation_status, es.translation_attempts, es.text], ['pending', 1, ES]);
  assert.equal(fr.translation_status, null, 'not reached; taken on the next pass');
  assert.equal(en.translation_status, null);
  // Tokens back (the plans the fixture gave every member): the next pass translates both.
  db.exec(AI_FIXTURE_PLANS);
  const next = await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.deepEqual([next.translated, next.pending], [2, 0]);
  assert.deepEqual(segments(db).map((s: any) => s.translation_status), ['done', 'done', 'same']);
});

test('a failed translation leaves the session usable: structuring reads the originals and stores no translated quote', async () => {
  const { env, db, calls } = world(translator({ failTranslation: true }));
  const r = await structureSession(env, { sessionId: SESSION, userId: ME, trigger: 'manual' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(segments(db).map((s: any) => [s.text, s.translation_status]), [[ES, 'pending'], [FR, 'pending'], [EN, 'same']]);
  const shown = calls.filter((c) => c.model === MID).map((c) => String(c.input.messages.at(-1).content)).join('\n');
  assert.ok(shown.includes(ES) && shown.includes(FR), 'the originals were read');
  const cite = JSON.parse(db.prepare("SELECT citation_json FROM validate_proposals WHERE kind = 'pain_severity'").get().citation_json);
  assert.equal(cite.quote, ES);
  assert.ok(!('quote_original' in cite) && !('source_lang' in cite), 'no translation, nothing beside the quote');
});

test('a pending segment is tried at most MAX_ATTEMPTS times, then left on its original', async () => {
  const { env, db, calls } = world(translator({ failTranslation: true }));
  for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.equal(translateCalls(calls).length, 2 * MAX_ATTEMPTS, 'two segments, three tries each, then no more');
  assert.deepEqual(segments(db).slice(0, 2).map((s: any) => s.translation_attempts), [MAX_ATTEMPTS, MAX_ATTEMPTS]);
});

// ── Consent, Indic, and what is never logged ────────────────────────────────

test('consent first: a session whose consent is not given is neither translated nor structured', async () => {
  const { env, db, calls } = world(translator());
  db.prepare("UPDATE interview_sessions SET consent_status = 'not_recorded' WHERE id = ?").run(SESSION);
  const r = await structureSession(env, { sessionId: SESSION, userId: ME, trigger: 'manual' });
  assert.deepEqual(r, { ok: false, reason: 'consent_not_recorded' });
  assert.equal(calls.length, 0, 'no model ran');
  assert.ok(segments(db).every((s: any) => s.translation_status === null));
});

test('an Indic working language: English goes to IndicTrans2 with its FLORES code, and its answer is read', async () => {
  const { env, db, calls } = world(translator());
  db.prepare("INSERT INTO user_settings (user_id, locale, validate_working_lang) VALUES (?, 'en', 'hi')").run(ME);
  db.prepare("DELETE FROM interview_transcript_segments WHERE text <> ?").run(EN);
  const pass = await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.equal(pass.translated, 1);
  const c = translateCalls(calls)[0];
  assert.deepEqual([c.model, c.input], [INDIC_TRANSLATION_MODEL, { text: EN, target_language: 'hin_Deva' }]);
  const r = await call(env, sessionsApp, 'GET', `/sessions/${SESSION}`);
  assert.equal(r.json.segments.find((s: any) => s.source === 'final').translation, `[hin_Deva] ${EN}`);
});

test('neither the original nor the translation reaches a log line', async () => {
  const { env } = world(translator({ failTranslation: true }));
  const seen: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => { seen.push(a.map(String).join(' ')); };
  try {
    await translateSession(env, { sessionId: SESSION, userId: ME });
    await structureSession(env, { sessionId: SESSION, userId: ME, trigger: 'manual' });
  } finally { [console.log, console.warn, console.error] = saved; }
  const all = seen.join('\n');
  for (const words of [ES, FR, 'odiamos', 'Ledgerly', PHRASEBOOK[ES]]) assert.ok(!all.includes(words), `logged: ${words}`);
});

test('detect_language runs only for a contested passage, on the small model', async () => {
  const { env, db, calls } = world((model, input) => (model === SMALL ? { response: 'es' } : translator()(model, input)));
  db.prepare("DELETE FROM interview_transcript_segments WHERE session_id = ?").run(SESSION);
  db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text) VALUES (?, 'final', 0, 1000, '[Interviewee]', 'la vida')`).run(SESSION);
  await translateSession(env, { sessionId: SESSION, userId: ME });
  assert.deepEqual(calls.map((c) => c.model), [SMALL, TRANSLATION_MODEL]);
  assert.equal(segments(db)[0].source_lang, 'es');
});

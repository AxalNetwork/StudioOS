/**
 * D8521 (#8521) — the fixtures and the harness for the Customer research
 * journey: one study, two interviewees, scripted answers, a stubbed model.
 *
 * Everything here is invented. The study is "Ledger Study"; the interviewees
 * are Rowan Example and Sasha Example; the addresses end in `.invalid` and the
 * phone number is a 555-01xx number. Nothing reaches a model, a mailer or the
 * network: `env.AI` is a recording stand-in, `env.FILES` an in-memory bucket,
 * and `env.JOB_QUEUE` a capture (no email is ever composed on this path).
 *
 * The world is the whole production schema (`freshSchema`, built once per run),
 * so a column a later migration adds is present here as it is in D1.
 */
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import { freshSchema } from './_schema_once.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import sessions from '../src/routes/founder_validate_sessions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

export const JWT_SECRET = 'd8521-fixture-only-signing-secret-0123456789';
export const FOUNDER = 2;       // owns the study
export const OUTSIDER = 3;      // owns nothing
export const PROJECT = 10;      // the study

/** The study's three questions: the talking points a session carries. */
export const QUESTIONS = [
  { id: 1, code: 'Q1', claim: 'How do you reconcile invoices today?' },
  { id: 2, code: 'Q2', claim: 'What does that cost you each week?' },
  { id: 3, code: 'Q3', claim: 'What would you pay to stop doing it?' },
];

/** The two interviewees, both invited (stage `invited`), and what each says. */
export const INTERVIEWEES = {
  rowan: {
    id: 1, name: 'Rowan Example', company: 'Example Freight Ltd',
    // One answer per chunk of the recording, in order.
    answers: [
      'We reconcile two systems by hand every Friday afternoon.',
      'It costs about six hours a week and one late payment a month.',
      'I would pay a few hundred a month for something that matched them for me.',
    ],
  },
  sasha: {
    id: 2, name: 'Sasha Example', company: 'Example Bakery Co',
    answers: [
      'Our invoices live in a shared spreadsheet that nobody owns.',
      'Email the report to sasha.example@example.invalid or ring me on (555) 010-0142 if it is late.',
      'Honestly I would try it for free before paying anything.',
    ],
  },
};

/** An answer that carries contact details: the redaction path's input. */
export const CONTACT_ANSWER = INTERVIEWEES.sasha.answers[1];
export const CONTACT_EMAIL = 'sasha.example@example.invalid';
export const CONTACT_PHONE = '(555) 010-0142';

/**
 * The stubbed model's summary reply for one transcript: a real overview
 * sentence citing the first span, a real quote, a quote nobody said, and an
 * overview sentence citing a span outside the transcript. The product must
 * keep the first two and drop the last two (the summary quotes only what was
 * said). `quoteReal` is the line it quotes word for word.
 */
export function scriptedSummary({ quoteReal, overview = 'They described their current process.', span = { from: 0, to: 2500 } }) {
  return JSON.stringify({
    overview: [
      { text: overview, cites: [span] },
      { text: 'They are about to churn.', cites: [{ from: 900000, to: 900500 }] },
    ],
    key_quotes: [{ quote: quoteReal }, { quote: 'We will switch vendors next quarter.' }],
    decisions: [],
    next_steps: [],
  });
}

export function world({ summaryReply } = {}) {
  __resetForTest();
  const db = freshSchema();
  db.exec(`INSERT INTO founders (id, name, email) VALUES (100, 'Founder One', 'founder.one@example.test'), (300, 'Founder Two', 'founder.two@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${FOUNDER}, 'founder.one@example.test', 'Founder One', 'founder', 100),
      (${OUTSIDER}, 'founder.two@example.test', 'Founder Two', 'founder', 300);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger Study', 100);`);
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?), (?, ?)').run(FOUNDER, 50_000_000, OUTSIDER, 50_000_000);
  for (const q of QUESTIONS) {
    db.prepare('INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES (?, ?, ?, ?, ?)').run(q.id, PROJECT, q.code, q.claim, q.id);
  }
  // The invitation: each interviewee is on the board at stage `invited`.
  for (const p of Object.values(INTERVIEWEES)) {
    db.prepare("INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_company, stage, invited_at) VALUES (?, ?, ?, ?, 'invited', datetime('now'))")
      .run(p.id, PROJECT, p.name, p.company);
  }

  const objects = new Map();
  const FILES = {
    async put(key, value) { objects.set(key, new Uint8Array(value)); },
    async get(key) {
      const v = objects.get(key);
      return v ? { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) } : null;
    },
    async delete(keys) { for (const k of [keys].flat()) objects.delete(k); },
  };

  // The stubbed inference: speech-to-text answers with the next scripted line
  // (chunks are transcribed in order, one call each), the summary prompt with
  // `script.summary`, anything else (structuring) with no placements.
  const calls = [];
  const script = { said: [], summary: summaryReply ?? null };
  const AI = withGuard({
    async run(model, input) {
      const entry = { model, kind: 'structure' };
      calls.push(entry);
      if (/whisper|nova|flux/.test(model)) {
        entry.kind = 'stt';
        const said = script.said.shift() ?? 'Nothing was said.';
        return { text: said, transcription_info: { language: 'en' }, segments: [{ start: 0, end: 2.5, text: said }] };
      }
      const sys = String(input?.messages?.[0]?.content ?? '');
      if (sys.startsWith('Summarise')) {
        entry.kind = 'summary';
        return { response: script.summary ?? JSON.stringify({ overview: [], key_quotes: [], decisions: [], next_steps: [] }) };
      }
      return { response: JSON.stringify({ placements: [] }) };
    },
  });
  const queued = [];
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES, AI, USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(body) { queued.push(body); } } };
  return { db, env, objects, calls, queued, script };
}

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', sessions);
  a.onError((err, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

export async function call(env, user, method, path, body, headers = {}) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const h = { Authorization: `Bearer ${tok}`, ...headers };
  let payload;
  if (body instanceof Uint8Array) payload = body;
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, { method, headers: h, body: payload }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A chunk of audio; the stubbed model ignores its bytes and answers from the script. */
export const chunkBytes = (seq) => new Uint8Array(64).fill(seq + 1);
export const putChunk = (w, sid, seq) =>
  call(w.env, FOUNDER, 'PUT', `/sessions/${sid}/chunks/${seq}`, chunkBytes(seq), { 'content-type': 'audio/webm', 'x-chunk-start-ms': String(seq * 10_000) });

/** Open a recorded session for an invited interviewee, with the study's three questions. */
export const openSession = (w, person, consent) => call(w.env, FOUNDER, 'POST', '/sessions', {
  project_id: PROJECT, interview_id: person.id, channel: 'in_person', live_model: null, consent,
  points: QUESTIONS.map((q) => q.id), client_key: `d8521-${person.id}`,
});

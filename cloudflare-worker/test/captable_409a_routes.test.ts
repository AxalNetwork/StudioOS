/**
 * 409A safe-harbour routes (Worker / D1 path).
 *
 * services/valuation409a.ts shipped tested and unreachable — no table,
 * no routes, no UI — so a founder could not find out whether their
 * option grants sat behind a §409A presumption. These routes are the
 * wiring; valuation409a.test.ts already covers the rule itself, so this
 * file covers what the wiring can get wrong:
 *
 *   - the "current" valuation is the latest BY VALUATION DATE, not by
 *     insertion order. Backfilling an old appraisal after a recent one
 *     must not roll the company's status backwards;
 *   - events reach the engine, so a priced round recorded after the
 *     valuation flips the status to invalidated;
 *   - access rides on the project, matching the cap table itself;
 *   - a delete cannot reach across projects.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_409a_routes.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import captable from '../src/routes/captable.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const PROJECT = 1;
const OTHER_PROJECT = 2;
const FOUNDER = 20;      // owns PROJECT
const OUTSIDER = 21;     // a founder who owns nothing here
const ADMIN = 22;

const app = new Hono();
app.route('/', captable);
app.onError((err: any, c) => {
  const msg = (err?.message ?? '') as string;
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: 'Internal server error' }, 500);
});

// `founderOwns` compares users.founder_id to projects.founder_id — a
// column on the user row, not a join through the founders table.
const USERS: any[] = [
  { id: FOUNDER, name: 'Fay Founder', role: 'founder', email: 'fay@example.com', is_active: 1, founder_id: 100 },
  { id: OUTSIDER, name: 'Otto Outsider', role: 'founder', email: 'otto@example.com', is_active: 1, founder_id: 999 },
  { id: ADMIN, name: 'Ada Admin', role: 'admin', email: 'ada@example.com', is_active: 1, founder_id: null },
];

async function mintToken(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

type Val = {
  id: number; project_id: number; valuation_date: string; fmv_per_share: number;
  provider: string | null; method: string | null;
  preferred_price_per_share: number | null; report_url: string | null;
  notes: string | null; created_by: number;
};
type Evt = {
  id: number; project_id: number; kind: string; occurred_on: string;
  note: string | null; created_by: number;
};

/**
 * Stateful stub. PROJECT carries founder_id 100 so FOUNDER owns it and
 * OUTSIDER (999) does not; OTHER_PROJECT belongs to a third founder, so
 * neither of them owns it.
 */
function makeEnv() {
  const valuations: Val[] = [];
  const events: Evt[] = [];
  let nextVal = 1, nextEvt = 1;

  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase().replace(/\s+/g, ' ');
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        if (s.includes('from users where id')) {
          const u = USERS.find((x) => x.id === bound[0]);
          return { results: u ? [u] : [] };
        }
        if (s.includes('from valuations_409a')) {
          return {
            results: valuations
              .filter((v) => v.project_id === bound[0])
              .sort((a, b) => (a.valuation_date < b.valuation_date ? 1
                : a.valuation_date > b.valuation_date ? -1 : b.id - a.id)),
          };
        }
        if (s.includes('from valuation_409a_events')) {
          return {
            results: events
              .filter((e) => e.project_id === bound[0])
              .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1)),
          };
        }
        return { results: [] };
      },
      async first() {
        if (s.includes('from projects where id')) {
          // Both projects exist; only PROJECT is owned by FOUNDER.
          if (bound[0] === PROJECT) return { id: PROJECT, founder_id: 100 };
          if (bound[0] === OTHER_PROJECT) return { id: OTHER_PROJECT, founder_id: 200 };
          return null;
        }
        if (s.startsWith('insert into valuations_409a')) {
          const row: Val = {
            id: nextVal++, project_id: bound[0], valuation_date: bound[1],
            fmv_per_share: bound[2], provider: bound[3], method: bound[4],
            preferred_price_per_share: bound[5], report_url: bound[6],
            notes: bound[7], created_by: bound[8],
          };
          valuations.push(row);
          return { id: row.id };
        }
        if (s.startsWith('insert into valuation_409a_events')) {
          const row: Evt = {
            id: nextEvt++, project_id: bound[0], kind: bound[1],
            occurred_on: bound[2], note: bound[3], created_by: bound[4],
          };
          events.push(row);
          return { id: row.id };
        }
        return null;
      },
      async run() {
        if (s.startsWith('delete from valuation_409a_events')) {
          const i = events.findIndex((e) => e.id === bound[0] && e.project_id === bound[1]);
          if (i < 0) return { meta: { changes: 0 } };
          events.splice(i, 1);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
    return api;
  };

  return {
    env: {
      JWT_SECRET,
      ENVIRONMENT: 'development',
      DB: {
        prepare: (sql: string) => handle(sql),
        async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
      },
    },
    valuations,
    events,
  };
}

function req(env: any, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } },
    env,
  );
}

const postValuation = (env: any, token: string, body: any) =>
  req(env, token, `/409a/${PROJECT}`, { method: 'POST', body: JSON.stringify(body) });
const postEvent = (env: any, token: string, body: any) =>
  req(env, token, `/409a/${PROJECT}/events`, { method: 'POST', body: JSON.stringify(body) });
const getStatus = (env: any, token: string) => req(env, token, `/409a/${PROJECT}`);

// A date far enough back that the 12-month window is definitely closed,
// and one recent enough that it is definitely open, whenever this runs.
const LONG_AGO = '2000-01-01';
const RECENT = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

test('a project with nothing on file reports no safe harbour', async () => {
  const { env } = makeEnv();
  const r = await (await getStatus(env, await mintToken(FOUNDER, 'founder'))).json() as any;
  assert.equal(r.status.state, 'none');
  assert.equal(r.current, null);
  assert.match(r.status.reason, /no safe harbour/i);
  // The checklist still renders — five rows, none fired.
  assert.equal(r.triggers.length, 5);
  assert.ok(r.triggers.every((t: any) => t.fired === false));
});

test('a recent valuation puts the company inside the presumption', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  assert.equal((await postValuation(env, token, {
    valuation_date: RECENT, fmv_per_share: 0.12, provider: 'Acme Valuations', method: 'backsolve',
  })).status, 201);

  const r = await (await getStatus(env, token)).json() as any;
  assert.equal(r.status.state, 'valid');
  assert.equal(r.current.fmv_per_share, 0.12);
  assert.equal(r.current.provider, 'Acme Valuations');
  assert.ok(r.status.days_remaining > 300);
});

test('an old valuation reports expired rather than valid', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  await postValuation(env, token, { valuation_date: LONG_AGO, fmv_per_share: 0.05 });
  const r = await (await getStatus(env, token)).json() as any;
  assert.equal(r.status.state, 'expired');
  assert.equal(r.status.days_remaining, 0);
});

test('a priced round after the valuation invalidates it early', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  await postValuation(env, token, { valuation_date: RECENT, fmv_per_share: 0.12 });

  const before = await (await getStatus(env, token)).json() as any;
  assert.equal(before.status.state, 'valid');

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  assert.equal((await postEvent(env, token, {
    kind: 'priced_round', occurred_on: yesterday, note: 'Series A priced',
  })).status, 201);

  const after = await (await getStatus(env, token)).json() as any;
  // Days remaining is still positive — that is exactly the trap. The
  // status has to outrank the calendar.
  assert.ok(after.status.days_remaining > 300);
  assert.equal(after.status.state, 'invalidated');
  assert.equal(after.status.invalidated_by.kind, 'priced_round');
  const fired = after.triggers.find((t: any) => t.kind === 'priced_round');
  assert.equal(fired.fired, true);
  assert.equal(fired.occurred_on, yesterday);
});

test('the current valuation is the latest by DATE, not by insertion order', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  await postValuation(env, token, { valuation_date: RECENT, fmv_per_share: 0.12 });
  // Backfilling last year's appraisal must not roll the status back.
  await postValuation(env, token, { valuation_date: LONG_AGO, fmv_per_share: 0.02 });

  const r = await (await getStatus(env, token)).json() as any;
  assert.equal(r.current.valuation_date, RECENT);
  assert.equal(r.current.fmv_per_share, 0.12);
  assert.equal(r.status.state, 'valid');
  assert.equal(r.history.length, 2, 'and the old one is kept, not overwritten');
});

test('the common:preferred ratio is null, not zero, without a preferred price', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  await postValuation(env, token, { valuation_date: RECENT, fmv_per_share: 0.12 });
  const r = await (await getStatus(env, token)).json() as any;
  assert.equal(r.common_to_preferred, null, 'a 0% ratio would read as a real finding');
});

test('the common:preferred ratio is flagged when a preferred price is on file', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  await postValuation(env, token, {
    valuation_date: RECENT, fmv_per_share: 0.20, preferred_price_per_share: 1.00,
  });
  const r = await (await getStatus(env, token)).json() as any;
  assert.equal(r.common_to_preferred.ratio, 0.2);
  assert.equal(r.common_to_preferred.flag, 'customary');
});

// ---------- validation ----------

test('a zero or negative FMV is refused', async () => {
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  for (const bad of [0, -1, 'abc']) {
    const res = await postValuation(env, token, { valuation_date: RECENT, fmv_per_share: bad });
    assert.equal(res.status, 400, `${bad} is not an appraisal result`);
  }
});

test('a malformed valuation date is refused rather than stored', async () => {
  const { env, valuations } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  const res = await postValuation(env, token, { valuation_date: 'last spring', fmv_per_share: 0.1 });
  assert.equal(res.status, 400);
  assert.equal(valuations.length, 0);
});

test('an unknown event kind is refused, so the checklist cannot silently drop it', async () => {
  const { env } = makeEnv();
  const res = await postEvent(env, await mintToken(FOUNDER, 'founder'), {
    kind: 'vibes_shifted', occurred_on: RECENT,
  });
  assert.equal(res.status, 400);
});

test('an unknown valuation method is refused', async () => {
  const { env } = makeEnv();
  const res = await postValuation(env, await mintToken(FOUNDER, 'founder'), {
    valuation_date: RECENT, fmv_per_share: 0.1, method: 'vibes',
  });
  assert.equal(res.status, 400);
});

// ---------- access ----------

test('409A reads and writes require auth', async () => {
  const { env } = makeEnv();
  assert.equal((await app.request(`/409a/${PROJECT}`, {}, env)).status, 401);
  assert.equal((await app.request(`/409a/${PROJECT}`, {
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
  }, env)).status, 401);
});

test('a founder cannot read another company\'s valuation', async () => {
  // Reading a company's FMV is reading its cap table by another route,
  // so this gate has to match the one on scenarios.
  const { env } = makeEnv();
  const res = await req(env, await mintToken(OUTSIDER, 'founder'), `/409a/${PROJECT}`);
  assert.equal(res.status, 403);
});

test('a founder cannot record a valuation against another company', async () => {
  const { env, valuations } = makeEnv();
  const res = await req(env, await mintToken(OUTSIDER, 'founder'), `/409a/${PROJECT}`, {
    method: 'POST', body: JSON.stringify({ valuation_date: RECENT, fmv_per_share: 9.99 }),
  });
  assert.equal(res.status, 403);
  assert.equal(valuations.length, 0);
});

test('an admin can read and record', async () => {
  const { env } = makeEnv();
  const token = await mintToken(ADMIN, 'admin');
  assert.equal((await getStatus(env, token)).status, 200);
  assert.equal((await postValuation(env, token, {
    valuation_date: RECENT, fmv_per_share: 0.15,
  })).status, 201);
});

// ---------- deletes ----------

test('a mis-entered event can be removed', async () => {
  const { env, events } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  const created = await (await postEvent(env, token, {
    kind: 'secondary_transaction', occurred_on: RECENT,
  })).json() as any;
  assert.equal(events.length, 1);

  const res = await req(env, token, `/409a/${PROJECT}/events/${created.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(events.length, 0);
});

test('a delete cannot reach an event belonging to another project', async () => {
  // The handler scopes the DELETE by project_id as well as event id;
  // without that, write access to any one project would be write access
  // to every project's event log.
  const { env, events } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  const created = await (await postEvent(env, token, {
    kind: 'priced_round', occurred_on: RECENT,
  })).json() as any;

  const res = await req(env, await mintToken(ADMIN, 'admin'),
    `/409a/${OTHER_PROJECT}/events/${created.id}`, { method: 'DELETE' });
  assert.equal(res.status, 404, 'the id exists, but not under that project');
  assert.equal(events.length, 1, 'and it survives');
});

test('valuations have no delete route — the record is the point', async () => {
  // An auditor asks what the FMV was on a grant date. Deleting an
  // appraisal destroys the only answer, so there is deliberately no way
  // to do it through the API.
  const { env } = makeEnv();
  const token = await mintToken(FOUNDER, 'founder');
  const created = await (await postValuation(env, token, {
    valuation_date: RECENT, fmv_per_share: 0.12,
  })).json() as any;
  const res = await req(env, token, `/409a/${PROJECT}/${created.id}`, { method: 'DELETE' });
  assert.notEqual(res.status, 200);
});

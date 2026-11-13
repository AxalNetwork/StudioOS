// D778 #2103 part 1: three inventoried runs return drafts, never business writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import brand from '../src/routes/brand.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const PAGE = 'Founder · Grow · Distribution';
const OPTIONS = [
  { key: 'form:landing', path: 'landing/autofill', task: 'brand_autofill', body: { name: 'Harbour', description: 'Coordinates local shipments', template: 'minimal' }, output: { name: 'Harbour', headline: 'Ship together', subheadline: 'A shared dispatch screen', tagline: 'Every shipment visible', cta: 'Start here', content: {} }, value: (b: any) => b.headline, expected: 'Ship together' },
  { key: 'form:palette', path: 'palette/suggest', task: 'brand_palette', body: { description: 'Coordinates local shipments', seed_color: '#112233' }, output: { primary: '#112233', background: '#ffffff', ink: '#000000', secondary: '#445566', accent: '#778899' }, value: (b: any) => b.palette.primary, expected: '#112233' },
  { key: 'draft:taglines', path: 'tagline/suggest', task: 'brand_taglines', body: { name: 'Harbour', description: 'Coordinates local shipments', audience: 'Dispatch teams', tone: 'warm', market_angle: 'coordination' }, output: { taglines: ['Every shipment visible'] }, value: (b: any) => b.taglines[0], expected: 'Every shipment visible' },
];
for (const option of OPTIONS) {
  test(`${option.key}: the stubbed run has its inventoried context, is charged to the member, and saves no page`, async () => {
    __resetForTest();
    const f = aiBudgetFixture();
    try {
      f.db.exec(readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8'));
      f.db.exec("CREATE TABLE landing_pages(id INTEGER PRIMARY KEY, headline TEXT); INSERT INTO landing_pages VALUES(1, 'Founder copy');");
      f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
      const calls: string[] = [];
      const env: any = { DB: f.DB, JWT_SECRET: 'f'.repeat(64), ENVIRONMENT: 'development', AI: withGuard({ run: async (model: string) => { calls.push(model); return { response: JSON.stringify(option.output), usage: { prompt_tokens: 30, completion_tokens: 20 } }; } }) };
      const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
      const app = new Hono(); app.route('/api/brand', brand);
      const post = () => app.request(`/api/brand/${option.path}`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(option.body) }, env);
      const r = await post(); const b: any = await r.json();
      assert.equal(r.status, 200);
      assert.equal(b.ai_generated, true);
      assert.equal(option.value(b), option.expected);
      const rows: any[] = f.db.prepare('SELECT user_id, task, rail_page, rail_option, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL').all();
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].user_id, rows[0].task, rows[0].rail_page, rows[0].rail_option], [2, option.task, PAGE, option.key]);
      assert.ok(rows[0].charged_microusd > 0);
      assert.deepEqual(f.db.prepare('SELECT * FROM landing_pages').all().map((x: any) => ({ ...x })), [{ id: 1, headline: 'Founder copy' }]);
      // The exact page's Manual switch suppresses the model; the existing local fallback stays unsaved.
      calls.length = 0;
      f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off',2,?,'','manual')").run(PAGE.toLowerCase());
      const off: any = await (await post()).json();
      assert.equal(off.ai_generated, false);
      assert.deepEqual(calls, []);
      assert.deepEqual(f.db.prepare('SELECT * FROM landing_pages').all().map((x: any) => ({ ...x })), [{ id: 1, headline: 'Founder copy' }]);
    } finally { f.db.close(); }
  });
}

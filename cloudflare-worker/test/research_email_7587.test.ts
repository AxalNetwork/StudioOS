/** #7587: only the hydrated HQ Super Admin can open an interview mail pack beyond the admin case restriction. Synthetic migrated SQLite and mounted route.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7587: elevated HQ interview mail
 * context, ordinary-admin and branch refusal, transcript exclusion and no invented address.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mail from '../src/routes/mail_drafts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
after(removeMigratedDatabases);
const secret = 'synthetic-7587-only-not-a-real-credential'.repeat(2);

test('interview Email: elevated admin gets the record only; ordinary admins, spoofed elevation and other admin profiles remain refused', async () => {
  const db = migratedDatabase();
  try {
    db.exec(`INSERT INTO users(id,role,name,email,is_active) VALUES
      (1,'admin','Synthetic HQ','hq@example.invalid',1),(2,'admin','Synthetic Admin','staff@example.invalid',1),
      (3,'founder','Synthetic Founder','founder@example.invalid',1);
      INSERT INTO super_admins(user_id) VALUES (1);
      INSERT INTO founders(id,name,email) VALUES (10,'Synthetic Founder','founder@example.invalid');
      INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic Venture',10);
      INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,pains_json,transcript)
        VALUES (11,1,'Synthetic Interviewee','done','[]','SYNTHETIC_TRANSCRIPT_NOT_FOR_EMAIL');
      INSERT INTO raise_prospects(id,uid,project_id,name,stage)
        VALUES (21,'synthetic-7587-prospect',1,'Synthetic Prospect','talking');
      INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel,status,consent_status)
        VALUES (40,'synthetic-7587-session',11,1,3,'in_person','transcribed','given');
      INSERT INTO interview_transcript_segments(session_id,source,start_ms,end_ms,speaker_label,text)
        VALUES (40,'final',0,1000,'A','SYNTHETIC_TRANSCRIPT_NOT_FOR_EMAIL');`);
    const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
    const app = new Hono<any>().route('/api/mail', mail);
    const read = async (id: number, ref: string, extra: any = {}) => {
      const token = await new SignJWT({ user_id: id, role: 'admin', is_super_admin: 1 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(secret));
      const r = await app.request(`/api/mail/context?person=${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${token}` } }, { ...env, ...extra });
      return { status: r.status, body: await r.json() as any };
    };
    const hq = await read(1, 'interviewee:11');
    assert.equal(hq.status, 200, JSON.stringify(hq.body));
    assert.equal(hq.body.person.ref, 'interviewee:11');
    assert.equal(hq.body.person.address, null, 'no guessed interviewee address');
    assert.deepEqual(hq.body.items.map((i: any) => i.ref), ['interviewee:11'], 'no company items added to admin mail');
    assert.doesNotMatch(JSON.stringify(hq.body), /SYNTHETIC_TRANSCRIPT_NOT_FOR_EMAIL/);
    assert.equal((await read(2, 'interviewee:11')).status, 404, 'JWT elevation is not the side-table grant');
    assert.equal((await read(1, 'interviewee:999')).status, 404, 'a missing record stays missing');
    assert.equal((await read(1, 'member:unshared')).status, 404, 'no new Network address access');
    assert.equal((await read(1, 'prospect:21')).status, 404, 'the exception covers interviews only');
    assert.equal((await read(1, 'interviewee:11', { BRANCH_CODE: 'synthetic' })).status, 404, 'a branch cannot gain HQ elevation');
  } finally { db.close(); }
});

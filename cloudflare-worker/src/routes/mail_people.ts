/**
 * D1348 (#3555, part 7 of #3547) — the People pane, mounted at `/api/mail`.
 *
 *   GET /people   { profile, groups: [{ key, label, people, empty, error }], note, empty }
 *
 * Each group is the member's profile's (`services/mail/people.ts`), each read
 * under its module's own rule. A person's `ref` opens their pack at
 * `GET /api/mail/context?person=`. A read only: a support session may read it.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { peopleFor } from '../services/mail/people';
import { refuse } from '../util/refusal';

const mailPeople = new Hono<{ Bindings: Env }>();

mailPeople.get('/people', async (c) => {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  try { return c.json(await peopleFor(c.env, user)); } catch (e) {
    return refuse(c, 503, { code: 'people_unreadable', message: 'Your people could not be read. Try again.', raw: e });
  }
});

export default mailPeople;

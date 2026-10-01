/**
 * Task #2 — News article notifications.
 *
 * TWO events, not the seven Task #2 specified:
 *
 *   author_submitted    → author confirmation
 *   admin_submitted     → every admin (queue alert)
 *
 * D166 NARROWED THIS UNION, and the reason is worth keeping. The other five
 * — `author_in_review`, `author_changes_requested`, `author_approved`,
 * `author_published`, `author_rejected` — were every one of them fired from
 * `routes/admin_news.ts` and from nowhere else. That router was retired for
 * skipping the recorded approve step, so the five kinds it alone reached had
 * no caller left: a producer with no reader, and a header that would have
 * gone on claiming seven. `routes/news.ts` keeps the two above, which are
 * the author's own submit path and are untouched by the retirement.
 *
 * The review transitions have not been lost — they belong to
 * `services/articleNotify.ts`, which the surviving `/api/admin/articles`
 * queue fires. That file carries the full seven.
 *
 * Email + in-app for the author; in-app + email for admins on submit.
 */
import type { Env } from '../types';
import { notify } from './notify';

export type NewsNotifyKind =
  | 'author_submitted'
  | 'admin_submitted';

interface Args {
  articleId: number;
  slug: string;
  title: string;
  authorUserId: number;
  reason?: string | null;
}

async function admins(env: Env): Promise<number[]> {
  try {
    const r: any = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1",
    ).all();
    return ((r?.results || []) as Array<{ id: number }>).map((u) => u.id);
  } catch {
    return [];
  }
}

const TITLES: Record<NewsNotifyKind, (a: Args) => { title: string; body: string }> = {
  author_submitted: (a) => ({
    title: 'Article submitted for review',
    body: `“${a.title}” is now in the admin queue. We'll let you know when review starts.`,
  }),
  admin_submitted: (a) => ({
    title: 'New article awaiting review',
    body: `“${a.title}” was just submitted and is waiting for an admin reviewer.`,
  }),
};

export async function notifyNews(env: Env, kind: NewsNotifyKind, args: Args): Promise<void> {
  const { title, body } = TITLES[kind](args);
  if (kind === 'admin_submitted') {
    // THIS LINK WAS 404ING, and the fix is its own change rather than a
    // consequence of D166's delete. `/admin/news` is an exact-path
    // <Navigate> in App.jsx with no wildcard, so `/admin/news/<id>` never
    // matched a route — and it was already broken while `admin_news.ts`
    // still existed, because the SPA never had a per-id page for it.
    // `articleNotify.ts` solved this on the articles side and its comment
    // says why: the admin queue route is `/admin/articles` with no per-id
    // route, and the queue page surfaces the specific article through its
    // own selection state.
    const link = `/admin/articles`;
    const recipients = await admins(env);
    for (const uid of recipients) {
      try {
        await notify(env, {
          userId: uid,
          type: 'news_admin_submitted',
          title,
          body,
          link,
          payload: { article_id: args.articleId, slug: args.slug },
          channels: ['in_app', 'email'],
        });
      } catch (e) {
        console.warn('[newsNotify] admin notify failed', e);
      }
    }
    return;
  }
  const link = `/news/author/${args.articleId}`;
  try {
    await notify(env, {
      userId: args.authorUserId,
      type: `news_${kind}`,
      title,
      body,
      link,
      payload: { article_id: args.articleId, slug: args.slug, reason: args.reason ?? null },
      channels: ['in_app', 'email'],
    });
  } catch (e) {
    console.warn('[newsNotify] author notify failed', e);
  }
}

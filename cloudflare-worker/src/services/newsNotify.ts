/**
 * Task #2 — News article notifications.
 *
 * Wraps `services/notify.ts` for the seven state-transition events
 * defined in the task spec table:
 *
 *   author_submitted    → author confirmation
 *   admin_submitted     → every admin (queue alert)
 *   author_in_review    → author when admin starts review
 *   author_changes_requested
 *   author_approved
 *   author_published
 *   author_rejected
 *
 * Email + in-app for the author; in-app + email for admins on submit.
 */
import type { Env } from '../types';
import { notify } from './notify';

export type NewsNotifyKind =
  | 'author_submitted'
  | 'admin_submitted'
  | 'author_in_review'
  | 'author_changes_requested'
  | 'author_approved'
  | 'author_published'
  | 'author_rejected';

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
  author_in_review: (a) => ({
    title: 'Your article is being reviewed',
    body: `An admin has started reviewing “${a.title}”.`,
  }),
  author_changes_requested: (a) => ({
    title: 'Changes requested on your article',
    body: `An admin requested changes on “${a.title}”${a.reason ? `: ${a.reason}` : '.'}`,
  }),
  author_approved: (a) => ({
    title: 'Article approved',
    body: `“${a.title}” was approved and is ready to be published.`,
  }),
  author_published: (a) => ({
    title: 'Article published',
    body: `“${a.title}” is now live on /news/${a.slug}.`,
  }),
  author_rejected: (a) => ({
    title: 'Article rejected',
    body: `“${a.title}” was rejected${a.reason ? `: ${a.reason}` : '.'} You can iterate from the saved draft.`,
  }),
};

export async function notifyNews(env: Env, kind: NewsNotifyKind, args: Args): Promise<void> {
  const { title, body } = TITLES[kind](args);
  if (kind === 'admin_submitted') {
    const link = `/admin/news/${args.articleId}`;
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

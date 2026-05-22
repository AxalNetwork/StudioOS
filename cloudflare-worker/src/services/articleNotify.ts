/**
 * Task #1 (Articles) — Article notifications.
 *
 * Mirrors `services/newsNotify.ts` but routes links to /articles/* surfaces.
 * Email + in-app for the author; in-app + email + slack for admins on submit.
 * Slack is wired by `services/notify.ts` automatically per user prefs.
 */
import type { Env } from '../types';
import { notify } from './notify';

export type ArticleNotifyKind =
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

const TITLES: Record<ArticleNotifyKind, (a: Args) => { title: string; body: string }> = {
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
    body: `“${a.title}” is now live on /articles/${a.slug}.`,
  }),
  author_rejected: (a) => ({
    title: 'Article rejected',
    body: `“${a.title}” was rejected${a.reason ? `: ${a.reason}` : '.'} You can iterate from the saved draft.`,
  }),
};

export async function notifyArticle(env: Env, kind: ArticleNotifyKind, args: Args): Promise<void> {
  const { title, body } = TITLES[kind](args);
  if (kind === 'admin_submitted') {
    // Admin queue route is `/admin/articles` (no per-id route on the
    // frontend); the queue page surfaces the specific article via its
    // own selection state.
    const link = `/admin/articles`;
    const recipients = await admins(env);
    for (const uid of recipients) {
      try {
        await notify(env, {
          userId: uid,
          type: 'articles_admin_submitted',
          title,
          body,
          link,
          payload: { article_id: args.articleId, slug: args.slug },
          channels: ['in_app', 'email', 'slack'],
        });
      } catch (e) {
        console.warn('[articleNotify] admin notify failed', e);
      }
    }
    return;
  }
  const link = kind === 'author_published'
    ? `/articles/${args.slug}`
    : `/articles/edit/${args.articleId}`;
  try {
    await notify(env, {
      userId: args.authorUserId,
      type: `articles_${kind}`,
      title,
      body,
      link,
      payload: { article_id: args.articleId, slug: args.slug, reason: args.reason ?? null },
      channels: ['in_app', 'email', 'slack'],
    });
  } catch (e) {
    console.warn('[articleNotify] author notify failed', e);
  }
}

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
  | 'author_unpublished'
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
  // D1293 (#3389): its own notice, with the admin's reason, instead of
  // "Changes requested". The article is back in Approved, not with the author.
  author_unpublished: (a) => ({
    title: 'Your article was unpublished',
    body: `An admin unpublished “${a.title}”${a.reason ? `: ${a.reason}` : '.'} It is back in Approved and no longer on Articles.`,
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
    // D1290 (#2383): each article has its own address in the queue,
    // `/admin/articles/<id>`, which opens its review panel.
    const link = `/admin/articles/${args.articleId}`;
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

/**
 * D1293 (#3389) — the author answered an admin's review comment. The admin
 * who wrote the comment is told, with a link to the article's review panel
 * (D1290's `/admin/articles/<id>`). The reply's text stays out of the notice.
 */
export async function notifyCommentReply(
  env: Env,
  args: { articleId: number; slug: string; title: string; commentAuthorId: number; commentId: number },
): Promise<void> {
  try {
    await notify(env, {
      userId: args.commentAuthorId,
      type: 'articles_admin_comment_reply',
      title: 'The author replied to your comment',
      body: `On “${args.title}”.`,
      link: `/admin/articles/${args.articleId}`,
      payload: { article_id: args.articleId, slug: args.slug, comment_id: args.commentId },
      channels: ['in_app'],
    });
  } catch (e) {
    console.warn('[articleNotify] reply notify failed', (e as Error)?.message);
  }
}

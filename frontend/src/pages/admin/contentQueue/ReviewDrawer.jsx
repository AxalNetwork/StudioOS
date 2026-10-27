/**
 * D1295 (#3391, ART3–ART5) — one article's review at `/admin/articles/<id>`:
 * Article (as readers see it, or its Markdown), Comments (paragraph comments,
 * replies, who resolved, edited), Revisions (pick two and compare) and
 * Details. The footer offers what `pipelineModel.actionsFor` allows; each
 * change opens `QueueDialog`. A failed block says so and leaves the rest.
 *
 * Reads: `GET /api/admin/articles/:id` (D1293 adds thread
 * fields and `saved_by_name`) and `GET /api/admin/articles/:id/revisions/:rev`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sheet, actionGhost, actionPrimary } from '../../../ui';
import { adminArticles as api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import useRecordCrumb from '../useRecordCrumb';
import QueueDialog from './QueueDialog';
import {
  ACTION_LABELS, DRAWER_TABS, OWN_NOTE, STAGE_LABEL, STATES, actionsFor, anchorFor, compareLines, dialogFor, ownArticle,
  paragraphsOf, refusalText, stageOf, threadsOf, waitText, when,
} from './pipelineModel';

const SUB = 'text-[12.5px] text-slate-500 dark:text-slate-400';
const H = 'm-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400';
const dayText = (at) => { const d = when(at); return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : null; };

export function StagePill({ stage }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${stage === 'rejected' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`} data-testid="cq-stage">
      {STAGE_LABEL[stage] || 'Not recorded'}
    </span>
  );
}

function BlockFailed({ onRetry, testId }) {
  return (
    <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid={testId}>
      {STATES.blockFailed} {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>}
    </p>
  );
}

/**
 * ART3: the article as readers see it, or its Markdown. The reader view is
 * `react-markdown`, as the author's own preview is: no raw HTML reaches the page.
 */
function ArticleTab({ article }) {
  const [md, setMd] = useState(false);
  return (
    <div className="flex flex-col gap-3" data-testid="cq-tab-article">
      <div role="group" aria-label="Show the article" className="flex gap-1">
        {[[false, 'As readers see it'], [true, 'Markdown']].map(([v, l]) => (
          <button key={l} type="button" aria-pressed={md === v} onClick={() => setMd(v)} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${md === v ? 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'text-slate-600 dark:text-slate-400'}`} data-testid={`cq-article-${v ? 'md' : 'read'}`}>{l}</button>
        ))}
      </div>
      {article.cover_r2_key && <img src={`/api/articles/cover/${article.id}`} alt="" className="max-h-48 rounded border border-slate-200 dark:border-slate-700" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      {article.subtitle && <p className="m-0 text-[14px] text-slate-600 dark:text-slate-300">{article.subtitle}</p>}
      {md
        ? <pre className="m-0 max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200" data-testid="cq-article-markdown">{article.body_markdown || ''}</pre>
        : <div className="prose max-h-[60vh] max-w-none overflow-y-auto text-[14px] dark:prose-invert" data-testid="cq-article-rendered"><ReactMarkdown>{article.body_markdown || ''}</ReactMarkdown></div>}
    </div>
  );
}

/** ART4: threads with their paragraph, replies, who resolved and edited; a new comment on the whole article or one paragraph. */
function CommentsTab({ article, comments, onChanged, onDelete, notify }) {
  const [text, setText] = useState('');
  const [on, setOn] = useState('');
  const [reply, setReply] = useState({});
  const [busy, setBusy] = useState(false);
  const paras = paragraphsOf(article.body_markdown);
  if (!Array.isArray(comments)) return <BlockFailed testId="cq-comments-unreadable" />;
  const threads = threadsOf(comments);
  const run = async (fn, okText) => {
    setBusy(true);
    try { await fn(); await onChanged(); if (okText) notify('success', okText); } catch (e) { reportError('ContentQueue:comment', e); notify('error', refusalText(e)); } finally { setBusy(false); }
  };
  const send = () => {
    const p = paras.find((x) => String(x.n) === on);
    return run(async () => { await api.addComment(article.id, text.trim(), p ? anchorFor(p) : null); setText(''); }, 'Comment sent. The author sees it in their editor.');
  };
  return (
    <div className="flex flex-col gap-3" data-testid="cq-tab-comments">
      {threads.length === 0 ? <p className={`m-0 ${SUB}`} data-testid="cq-comments-empty">No comments on this article.</p> : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {threads.map((c) => (
            <li key={c.id} className={`rounded-lg border p-3 ${c.resolved_at ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`} data-testid={`cq-thread-${c.id}`}>
              <p className="m-0 text-[11.5px] text-slate-500 dark:text-slate-400" data-testid="cq-thread-anchor">{c.anchor ? `On ${c.anchor}` : 'On the whole article'}</p>
              <p className="m-0 mt-1 text-[13px] text-slate-900 dark:text-slate-100">{c.body}</p>
              <p className="m-0 mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">
                {c.author_name || 'Name not recorded'} · {dayText(c.created_at) || 'time not recorded'}{c.edited_at ? ' · Edited' : ''}
              </p>
              {c.resolved_at && <p className="m-0 mt-1 text-[11.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="cq-thread-resolved">{c.resolved_by_name ? `Resolved by ${c.resolved_by_name}` : 'Resolved · who resolved it was not recorded'}{dayText(c.resolved_at) ? ` on ${dayText(c.resolved_at)}` : ''}</p>}
              {c.replies.length > 0 && (
                <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                  {c.replies.map((r) => (
                    <li key={r.id} data-testid={`cq-reply-${r.id}`}>
                      <p className="m-0 text-[12.5px] text-slate-800 dark:text-slate-200">{r.body}</p>
                      <p className="m-0 text-[11px] text-slate-500 dark:text-slate-400">{r.author_name || 'Name not recorded'}{Number(r.author_id) === Number(article.author_user_id) ? ' (author)' : ''} · {dayText(r.created_at) || 'time not recorded'}{r.edited_at ? ' · Edited' : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={reply[c.id] || ''} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} placeholder="Reply…" aria-label="Reply to this comment"
                  className="min-h-[36px] flex-1 rounded border border-slate-300 bg-white px-2 text-[12.5px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" data-testid={`cq-reply-input-${c.id}`} />
                <button type="button" disabled={busy || !(reply[c.id] || '').trim()} className={actionGhost}
                  onClick={() => run(async () => { await api.addComment(article.id, reply[c.id].trim(), null, c.id); setReply({ ...reply, [c.id]: '' }); }, 'Reply sent.')} data-testid={`cq-reply-send-${c.id}`}>Reply</button>
                <button type="button" disabled={busy} className={actionGhost} onClick={() => run(() => api.resolveComment(c.id, !c.resolved_at), c.resolved_at ? 'Reopened.' : 'Resolved.')} data-testid={`cq-resolve-${c.id}`}>{c.resolved_at ? 'Reopen' : 'Resolve'}</button>
                <button type="button" disabled={busy} className="text-[12.5px] font-semibold text-red-700 underline dark:text-red-300" onClick={() => onDelete(c)} data-testid={`cq-delete-${c.id}`}>Delete…</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-300">Comment on:
          <select value={on} onChange={(e) => setOn(e.target.value)} className="min-h-[36px] max-w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" data-testid="cq-comment-on">
            <option value="">The whole article</option>
            {paras.map((p) => <option key={p.n} value={String(p.n)}>{anchorFor(p)}</option>)}
          </select>
        </label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What should the author look at?" aria-label="Comment"
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[13px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" data-testid="cq-comment-text" />
        <div className="flex items-center justify-between gap-2">
          <span className={SUB}>The author sees this in their editor.</span>
          <button type="button" disabled={busy || !text.trim()} onClick={send} className={actionPrimary} data-testid="cq-comment-send">Send</button>
        </div>
      </div>
    </div>
  );
}

/** ART5: each revision with who saved it; pick two to compare their text. */
function RevisionsTab({ article, revisions }) {
  const [picked, setPicked] = useState([]);
  const [cmp, setCmp] = useState(null);
  if (!Array.isArray(revisions)) return <BlockFailed testId="cq-revisions-unreadable" />;
  const toggle = (rev) => setPicked((p) => (p.includes(rev) ? p.filter((x) => x !== rev) : [...p, rev].slice(-2)));
  const compare = async () => {
    const [a, b] = [...picked].sort((x, y) => x - y);
    setCmp({ state: 'loading', a, b });
    try {
      const [ra, rb] = await Promise.all([api.revision(article.id, a), api.revision(article.id, b)]);
      setCmp({ state: 'ready', a, b, lines: compareLines(ra?.revision?.body_markdown ?? '', rb?.revision?.body_markdown ?? '') });
    } catch (e) { reportError('ContentQueue:revision', e); setCmp({ state: 'failed', a, b }); }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="cq-tab-revisions">
      <p className={`m-0 ${SUB}`}>Each revision keeps the full text. Pick two to compare.</p>
      {revisions.length === 0 ? <p className={`m-0 ${SUB}`}>No revision is saved yet.</p> : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={picked.includes(r.rev)} onChange={() => toggle(r.rev)} aria-label={`Pick revision ${r.rev}`} data-testid={`cq-rev-pick-${r.rev}`} />
              <span className="font-semibold">Rev {r.rev}</span>
              <span>· {r.reason || 'Saved'} · {STAGE_LABEL[stageOf({ status: r.status_at_save })] || r.status_at_save || 'status not recorded'}</span>
              <span>· {r.saved_by_name || 'Saved by an account that no longer exists'}</span>
              <span className="text-slate-500 dark:text-slate-400">· {dayText(r.created_at) || 'time not recorded'}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={picked.length !== 2} onClick={compare} className={`${actionGhost} w-fit`} data-testid="cq-rev-compare">Compare</button>
      {cmp?.state === 'loading' && <p className={`m-0 ${SUB}`}>{STATES.reading}</p>}
      {cmp?.state === 'failed' && <BlockFailed onRetry={compare} testId="cq-compare-unreadable" />}
      {cmp?.state === 'ready' && (
        <div className="max-h-[50vh] overflow-y-auto rounded border border-slate-200 p-2 font-mono text-[12px] dark:border-slate-800" data-testid="cq-compare">
          <p className={`m-0 mb-1 ${SUB}`}>Rev {cmp.a} → Rev {cmp.b}. Removed is struck through; added is tinted.</p>
          {cmp.lines.map((l, i) => (
            <div key={i} className={l.kind === 'removed' ? 'text-red-800 line-through dark:text-red-300' : l.kind === 'added' ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'text-slate-700 dark:text-slate-300'} data-kind={l.kind}>{l.text || ' '}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** ART5's Details: who and when, featured, views and reach. A field not recorded says so. */
function DetailsTab({ article, viewer, followerReach }) {
  const rows = [
    ['Author', `${article.author_name || 'Name not recorded'}${article.author_role ? ` · ${article.author_role}` : ''}`],
    ['Stage', STAGE_LABEL[stageOf(article)] || 'Not recorded'],
    ['Submitted', dayText(article.submitted_at) || 'Not recorded'],
    ['Reviewer', article.reviewer_user_id ? (Number(article.reviewer_user_id) === Number(viewer?.userId) ? 'You' : 'Another admin') : 'Nobody has started a review'],
    ['Approved by', article.approved_by ? (Number(article.approved_by) === Number(viewer?.userId) ? 'You' : 'Another admin') : (article.approved_at ? 'Not recorded (approved before this was kept)' : 'Not approved')],
    ['Goes out', dayText(article.publish_at) || 'No time set'],
    ['Published', dayText(article.published_at) || 'Not published'],
    ['Featured on Articles', article.featured_at ? `Since ${dayText(article.featured_at)}` : 'No'],
    ['Sector', article.sector || 'Not recorded'],
    ['Length', article.word_count != null ? `${article.word_count} words · about ${article.read_minutes ?? '?'} min` : 'Not recorded'],
    ['Address', article.slug ? `axal.vc/articles/${article.slug}` : 'Not set'],
    ['Views, all time', article.views != null ? String(article.views) : 'Not recorded'],
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="cq-tab-details">
      <dl className="m-0 grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt className="text-slate-500 dark:text-slate-400">{k}</dt><dd className="m-0 text-slate-900 dark:text-slate-100" data-testid={`cq-detail-${k.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{v}</dd></React.Fragment>
        ))}
      </dl>
      <p className={`m-0 ${SUB}`}>{STATES.views}</p>
      {(article.tags || []).length > 0 && <p className="m-0 flex flex-wrap gap-1">{article.tags.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11.5px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">{t}</span>)}</p>}
      <h4 className={H}>Followers told</h4>
      {followerReach == null ? <p className={`m-0 ${SUB}`}>Not recorded before reach was kept (migration 637).</p>
        : followerReach.length === 0 ? <p className={`m-0 ${SUB}`}>Not published yet, so nobody was told.</p>
          : <ul className="m-0 list-none p-0 text-[12.5px] text-slate-700 dark:text-slate-300">{followerReach.map((r, i) => <li key={i}>{dayText(r.published_at) || 'Time not recorded'} · {r.notified ?? 'Not recorded'} of {r.followers ?? 'Not recorded'} followers told</li>)}</ul>}
    </div>
  );
}

const ACTIONS = {
  start: (id) => api.startReview(id),
  approve: (id) => api.approve(id),
  approve_self: (id, r) => api.approve(id, r.reason),
  request: (id, r) => api.requestChanges(id, r.reason),
  reject: (id, r) => api.reject(id, r.reason),
  schedule: (id, r) => api.schedule(id, r.publishAt),
  clear: (id) => api.schedule(id, null),
  publish: (id) => api.publish(id),
  publish_self: (id, r) => api.publish(id, r.reason),
  unpublish: (id, r) => api.unpublish(id, r.reason),
  feature: (id) => api.feature(id, true),
  unfeature: (id) => api.feature(id, false),
};

/** The drawer. `onChanged` refreshes the board or list; `notify(kind, text)` is the page's toast. */
export default function ReviewDrawer({ id, viewer, onClose, onChanged, notify }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [tab, setTab] = useState('article');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const load = useCallback(async () => {
    try { setRead({ status: 'ready', data: await api.get(id) }); } catch (e) { reportError('ContentQueue:article', e); setRead({ status: 'failed' }); }
  }, [id]);
  useEffect(() => { setRead({ status: 'loading' }); setTab('article'); load(); }, [load]);
  const article = read.data?.article || null;
  // D775 (#2101): the article under review is the rail's record.
  useRecordCrumb(article?.title, 'article', article?.id);

  const confirm = async (input) => {
    const kind = dialog.kind;
    setBusy(true); setDialogError(null);
    try {
      if (kind === 'delete_comment') await api.deleteComment(dialog.comment.id);
      else await ACTIONS[kind](id, input);
      setDialog(null);
      await load(); await onChanged?.();
      notify('success', dialogFor(kind, article).done);
    } catch (e) {
      reportError('ContentQueue:action', e);
      if (e?.status === 409 && e?.code !== 'featured_full') {
        // ART15d: the article moved before the click. Read it again and say where it went.
        setDialog(null);
        let moved = null;
        try { const fresh = await api.get(id); setRead({ status: 'ready', data: fresh }); moved = STAGE_LABEL[stageOf(fresh.article)]; } catch { moved = null; }
        await onChanged?.();
        notify('stale', refusalText(e, moved));
      } else setDialogError(refusalText(e));
    } finally { setBusy(false); }
  };

  const actions = article ? actionsFor(article, viewer) : [];
  const footer = article ? (
    <div className="flex w-full flex-wrap items-center gap-2" data-testid="cq-drawer-actions">
      {actions.filter((a) => a !== 'own_note').map((a) => (
        <button key={a} type="button" onClick={() => { setDialogError(null); setDialog({ kind: a }); }} className={['publish', 'approve', 'start', 'schedule'].includes(a) ? actionPrimary : actionGhost} data-testid={`cq-action-${a}`}>{ACTION_LABELS[a]}</button>
      ))}
      {actions.includes('own_note') && (
        <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="cq-own-note">
          <b>{OWN_NOTE.title}.</b> {OWN_NOTE.line}
        </p>
      )}
    </div>
  ) : null;

  const title = article?.title || (read.status === 'failed' ? 'The article could not be read' : STATES.reading);
  return (
    <Sheet label={`Review: ${title}`} eyebrow="Review" title={title} onClose={onClose} width={760} phone="sheet" footer={footer} testId="cq-drawer">
      {read.status === 'loading' && <p className={`m-0 ${SUB}`} aria-live="polite" data-testid="cq-drawer-loading">{STATES.reading}</p>}
      {read.status === 'failed' && (
        <p className="m-0 text-[13px] text-red-700 dark:text-red-300" role="alert" data-testid="hq-article-unreadable">
          Unreadable. The article and its review comments could not be read just now. <button type="button" onClick={load} className="font-semibold underline">Try again</button>
        </p>
      )}
      {article && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-400" data-testid="cq-drawer-meta">
            <StagePill stage={stageOf(article)} />
            <span>{waitText(article)}</span>
            <span>· by {article.author_name || 'Name not recorded'}{ownArticle(article, viewer) ? ' (you)' : ''}</span>
            {article.featured_at && <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200" data-testid="cq-featured">Featured on Articles</span>}
          </div>
          <div role="tablist" aria-label="Review" className="flex gap-3 border-b border-slate-200 dark:border-slate-800">
            {DRAWER_TABS.map((t) => (
              <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`-mb-px min-h-[40px] border-b-2 text-[13px] font-semibold ${tab === t.key ? 'border-violet-600 text-slate-900 dark:text-slate-100' : 'border-transparent text-slate-500 dark:text-slate-400'}`} data-testid={`cq-drawer-tab-${t.key}`}>
                {t.label}{t.key === 'comments' && Array.isArray(read.data.comments) ? ` · ${read.data.comments.filter((c) => !c.parent_id && !c.resolved_at).length} open` : ''}
              </button>
            ))}
          </div>
          {tab === 'article' && <ArticleTab article={article} />}
          {tab === 'comments' && <CommentsTab article={article} comments={read.data.comments} onChanged={load} notify={notify} onDelete={(c) => { setDialogError(null); setDialog({ kind: 'delete_comment', comment: c }); }} />}
          {tab === 'revisions' && <RevisionsTab article={article} revisions={read.data.revisions} />}
          {tab === 'details' && <DetailsTab article={article} viewer={viewer} followerReach={read.data.follower_reach} />}
        </div>
      )}
      {dialog && <QueueDialog key={dialog.kind} kind={dialog.kind} article={article} busy={busy} error={dialogError} onConfirm={confirm} onClose={() => setDialog(null)} />}
    </Sheet>
  );
}

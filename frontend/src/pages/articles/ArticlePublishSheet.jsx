import React, { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import Sheet from '../../ui/Sheet';
import { ghost as actionGhost, primary as actionPrimary } from '../../ui/ActionSheet';
import { slugify } from '../../lib/articleMarkdown';
import { appOrigin } from '../../lib/branchHost';
import { SEARCH_DESCRIPTION_MAX, SEARCH_TITLE_MAX, searchPreview } from './articleCanvas';

/**
 * D1408 (#3694) — AR5, "Publish…": everything a reader and a search engine
 * see before the article goes to review.
 *
 * Two of the canvas's rows are not drawn (D1408 §3):
 *   · Audience (Public / Members only / Unlisted): an article has no audience
 *     column; every published article is public (S1's owner pick D(a)).
 *   · "On a date": a member cannot schedule. An admin sets the publish time
 *     in the Content queue (D484), so the sheet says when it goes out instead.
 *
 * The fields edit the page's own draft (`editing`), which autosaves; the
 * primary button is the page's own submit, so PII, the weekly limit and the
 * length checks answer here exactly as before.
 */
/** The viewer's time zone, named as the browser knows it. */
function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

export default function ArticlePublishSheet({
  article, editing, setEditing, sectors = [], editable, slugTouched, setSlugTouched,
  onClose, onSave, onSubmit, saving, submitting, onAsk, coverSrc,
  chain = 'none', onPublishNow, publishing, onSchedule, scheduling,
}) {
  const [tagInput, setTagInput] = useState('');
  const [when, setWhen] = useState('');
  // D1408 (AR5): an admin publishes or schedules another member's article (D1292's chain).
  const adminCanPublish = (chain === 'direct' || chain === 'override') && article?.status !== 'published';
  const adminCanSchedule = chain === 'direct' && article?.status === 'approved';
  const pv = searchPreview({ ...editing, slug: editing.slug || slugify(editing.title || '') }, appOrigin());
  const set = (k) => (e) => setEditing((p) => ({ ...p, [k]: e.target.value }));
  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    if (!t) return;
    setEditing((p) => ((p.tags || []).includes(t) ? p : { ...p, tags: [...(p.tags || []), t].slice(0, 8) }));
    setTagInput('');
  };
  const canSubmit = editable && ['draft', 'changes_requested', 'rejected'].includes(article?.status);
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose}>Close</button>
      {adminCanPublish && onPublishNow && (
        <button type="button" className={actionGhost} onClick={onPublishNow} disabled={publishing} data-testid="article-sheet-publish-now">
          {publishing ? 'Publishing…' : 'Publish now'}
        </button>
      )}
      {editable && <button type="button" className={actionGhost} onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
      {canSubmit && (
        <button type="button" className={actionPrimary} onClick={onSubmit} disabled={submitting} data-testid="article-send-for-review">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null} {article.status === 'draft' ? 'Send for review' : 'Send again'}
        </button>
      )}
    </div>
  );
  const askBtn = (label) => editable && onAsk && (
    <button type="button" onClick={() => onAsk('draft:article-seo')} className="text-[11px] inline-flex items-center gap-1 text-violet-700 dark:text-violet-300 hover:underline" aria-label={`Ask Eadwyn for the ${label}`}>
      <Sparkles className="w-3 h-3" /> Ask
    </button>
  );
  const field = 'w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 disabled:opacity-60';

  return (
    <Sheet label="Publish" eyebrow="Articles" title="Publish…" onClose={onClose} width={560} testId="article-publish-sheet" footer={footer}>
      <div className="flex flex-col gap-5 px-5 py-4 text-[13px]">
        <section>
          <div className="text-xs text-slate-500 mb-1">Who can read it</div>
          <p className="m-0">Public, once approved. Anyone can read a published article at its address.</p>
        </section>

        <section>
          <label className="text-xs text-slate-500" htmlFor="article-slug">Address</label>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-500 shrink-0">/articles/</span>
            <input id="article-slug" className={field} disabled={!editable || article?.status === 'published'} value={editing.slug || ''}
              placeholder={slugify(editing.title || '') || 'your-article'}
              onChange={(e) => { setEditing((p) => ({ ...p, slug: e.target.value })); setSlugTouched(true); }} />
            {slugTouched && editable && (
              <button type="button" className="text-xs text-slate-500 hover:underline shrink-0" onClick={() => { setEditing((p) => ({ ...p, slug: '' })); setSlugTouched(false); }}>Auto</button>
            )}
          </div>
          {article?.status === 'published' && <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">Locked: the article is published.</div>}
        </section>

        <section>
          <div className="flex justify-between items-center">
            <label className="text-xs text-slate-500" htmlFor="article-seo-title">Search title <span className={pv.titleTooLong ? 'text-amber-600' : ''}>{(editing.seo_title || '').length}/{SEARCH_TITLE_MAX}</span></label>
            {!editing.seo_title && askBtn('search title')}
          </div>
          <input id="article-seo-title" className={`${field} mt-1`} disabled={!editable} value={editing.seo_title || ''} onChange={(e) => setEditing((p) => ({ ...p, seo_title: e.target.value.slice(0, 120) }))} placeholder={editing.title || 'The title search engines show'} />
        </section>

        <section>
          <div className="flex justify-between items-center">
            <label className="text-xs text-slate-500" htmlFor="article-excerpt">Search description {(editing.excerpt || '').length}/{SEARCH_DESCRIPTION_MAX}</label>
            {!editing.excerpt && askBtn('search description')}
          </div>
          <textarea id="article-excerpt" rows={3} className={`${field} mt-1`} disabled={!editable} value={editing.excerpt || ''} onChange={(e) => setEditing((p) => ({ ...p, excerpt: e.target.value.slice(0, SEARCH_DESCRIPTION_MAX) }))} placeholder="One or two sentences for search results and social cards" />
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3" data-testid="article-search-preview">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Search preview</div>
          <div className="text-[15px] text-blue-700 dark:text-blue-300">{pv.title}</div>
          <div className="text-xs text-emerald-700 dark:text-emerald-400 break-all">{pv.url}</div>
          <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{pv.description || 'Add a search description so this line is not blank.'}</div>
        </section>

        <section>
          <div className="text-xs text-slate-500 mb-1">When</div>
          {adminCanSchedule ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="article-schedule">
              <input type="datetime-local" aria-label="Publish at" value={when} onChange={(e) => setWhen(e.target.value)}
                className="text-sm px-3 py-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900" />
              <span className="text-xs text-slate-500">{localZone()}</span>
              <button type="button" className={actionGhost} disabled={!when || scheduling}
                onClick={async () => { if (await onSchedule?.(new Date(when).toISOString())) onClose(); }}>
                {scheduling ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          ) : chain === 'override' && article?.status === 'approved' ? (
            <p className="m-0">You wrote this article, so another admin schedules it. You can publish it now with your reason.</p>
          ) : (
            <p className="m-0">As soon as it is approved. The review team may set a publish time; you will see it here when they do.</p>
          )}
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500" htmlFor="article-sector">Sector</label>
            <select id="article-sector" className={`${field} mt-1`} disabled={!editable} value={editing.sector || ''} onChange={set('sector')}>
              <option value="">None</option>
              {sectors.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500" htmlFor="article-canonical">Canonical address (optional)</label>
            <input id="article-canonical" className={`${field} mt-1`} disabled={!editable} value={editing.canonical_url || ''} onChange={set('canonical_url')} placeholder="https://…" />
          </div>
        </section>

        <section>
          <div className="text-xs text-slate-500 mb-1">Tags {(editing.tags || []).length}/8</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {(editing.tags || []).map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded inline-flex items-center gap-1">
                {t}
                {editable && <button type="button" aria-label={`Remove ${t}`} onClick={() => setEditing((p) => ({ ...p, tags: (p.tags || []).filter((x) => x !== t) }))}><X className="w-3 h-3" /></button>}
              </span>
            ))}
            {editable && (editing.tags || []).length < 8 && (
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add a tag" aria-label="Add a tag" className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 w-28" />
            )}
          </div>
        </section>

        <section>
          <div className="text-xs text-slate-500 mb-1">Cover and social card</div>
          {coverSrc ? <img src={coverSrc} alt="" className="w-full max-h-48 object-cover rounded border border-slate-200 dark:border-slate-700" />
            : <p className="m-0 text-slate-500">No cover yet. Add one from the editor; social cards then use it.</p>}
        </section>
      </div>
    </Sheet>
  );
}

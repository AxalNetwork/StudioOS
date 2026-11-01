import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { articleAuthoringApi } from '../../lib/api/articleAuthoring.js';
import { railProposalsApi } from '../../lib/api/railProposals.js';
import { railPressHeaders } from '../../lib/railPage';
import { reportError } from '../../lib/log';
import {
  ARTICLE_ACTIONS, REWRITE_TONES, assistInput, chargedLine, holdsLine, proposalMarkdown, refusalMessage,
} from './articleCanvas';

/**
 * D1408 (#3694) — AR3, Eadwyn's writing panel on an article.
 *
 * The canvas draws it as Eadwyn's panel (ARTICLES · WRITING). The shared Ask
 * panel that slides out of the AIRail (#3706) is not built, so the article
 * page draws this one beside the article, non-modal: the member keeps
 * selecting text while it is open. When #3706 lands, this body moves into it.
 *
 * Every press runs one D1409 option: quote, then run. A run leaves a proposal;
 * nothing goes into the article until the member presses Insert or Replace,
 * and the page's own save writes it. Discard decides the proposal and places
 * nothing.
 */

const record = (id) => `articles:${id}`;
const OPTIONS = ARTICLE_ACTIONS.map((a) => a.option);

function ProposalCard({ item, onPlace, onDiscard, onApplySeo, onApplyHeadline, editable, busy }) {
  const p = item.proposal;
  const pl = p?.payload || {};
  const md = proposalMarkdown(p);
  const action = ARTICLE_ACTIONS.find((a) => a.option === p.rail_option);
  const isRewrite = p.rail_option === 'rewrite:article';
  return (
    <li className="rounded-lg border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-slate-900 p-3 text-[13px]" data-testid="article-proposal">
      <div className="text-[11px] uppercase tracking-wide text-violet-700 dark:text-violet-300 font-semibold">
        {action?.label || 'Proposal'}{isRewrite && pl.tone ? ` · ${(REWRITE_TONES.find((t) => t.key === pl.tone) || {}).label || pl.tone}` : ''}
      </div>
      {isRewrite && pl.before && (
        <p className="mt-2 text-slate-400 line-through whitespace-pre-wrap">{pl.before}</p>
      )}
      {md && <p className="mt-2 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{md}</p>}
      {Array.isArray(pl.headlines) && (
        <ul className="mt-2 space-y-1">
          {pl.headlines.map((h) => (
            <li key={h} className="flex items-start justify-between gap-2">
              <span>{h}</span>
              {editable && <button type="button" className="text-xs text-violet-700 dark:text-violet-300 hover:underline shrink-0" disabled={busy} onClick={() => onApplyHeadline(item, h)}>Use</button>}
            </li>
          ))}
        </ul>
      )}
      {(pl.seo_title || pl.excerpt) && (
        <dl className="mt-2 space-y-1">
          {pl.seo_title && <><dt className="text-[11px] text-slate-500">Search title</dt><dd>{pl.seo_title}</dd></>}
          {pl.excerpt && <><dt className="text-[11px] text-slate-500">Excerpt</dt><dd>{pl.excerpt}</dd></>}
        </dl>
      )}
      {Array.isArray(pl.claims) && (
        <ul className="mt-2 space-y-1.5" data-testid="article-fact-claims">
          {pl.claims.length === 0 && <li className="text-slate-500">No claim needs a source.</li>}
          {pl.claims.map((c, i) => (
            <li key={i}><q className="italic">{c.quote}</q><div className="text-xs text-slate-500">{c.why}</div></li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {md && editable && isRewrite && item.range && (
          <button type="button" disabled={busy} onClick={() => onPlace(item, 'replace')} className="text-xs px-2.5 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">Replace</button>
        )}
        {md && editable && (
          <button type="button" disabled={busy} onClick={() => onPlace(item, 'below')} className="text-xs px-2.5 py-1 rounded border border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50">Insert below</button>
        )}
        {(pl.seo_title || pl.excerpt) && editable && (
          <button type="button" disabled={busy} onClick={() => onApplySeo(item)} className="text-xs px-2.5 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">Use both</button>
        )}
        <button type="button" disabled={busy} onClick={() => onDiscard(item)} className="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          {Array.isArray(pl.claims) ? 'Done' : 'Discard'}
        </button>
      </div>
      {item.cost !== undefined && (
        <div className="mt-2 text-[11px] text-slate-500" data-testid="article-proposal-cost">{chargedLine(item.cost?.charged_microusd ?? null, item.hold)}</div>
      )}
    </li>
  );
}

export default function ArticleWritingPanel({
  articleId, editable, getContext, onPlace, onApplySeo, onApplyHeadline, onClose, onWaiting, autoRun = null,
}) {
  const [brief, setBrief] = useState('');
  const [heading, setHeading] = useState('');
  const [tone, setTone] = useState('shorter');
  const [quotes, setQuotes] = useState({});
  const [running, setRunning] = useState(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState(() => getContext?.() || {});

  useEffect(() => { onWaiting?.(items.length); }, [items.length, onWaiting]);

  // What the member is working on, refreshed while the panel is open.
  useEffect(() => {
    const t = setInterval(() => setFocus(getContext?.() || {}), 700);
    return () => clearInterval(t);
  }, [getContext]);

  // The proposals still waiting on this article, from an earlier visit. A read
  // that fails is said (AR6e), never shown as "nothing waiting".
  const [waitingUnread, setWaitingUnread] = useState(false);
  const [readTick, setReadTick] = useState(0);
  useEffect(() => {
    if (!articleId) return undefined;
    let live = true;
    Promise.allSettled(OPTIONS.map((option) => railProposalsApi.list({ option, record: record(articleId), status: 'proposed' })
      .then((r) => r?.proposals || [])))
      .then((results) => {
        if (!live) return;
        setWaitingUnread(results.some((r) => r.status === 'rejected'));
        const seen = new Set();
        const read = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
          .filter((p) => p?.uid && !seen.has(p.uid) && seen.add(p.uid)).map((proposal) => ({ proposal }));
        setItems((prev) => {
          const fresh = prev.filter((x) => x.cost !== undefined && !seen.has(x.proposal.uid));
          return [...fresh, ...read];
        });
      });
    return () => { live = false; };
  }, [articleId, readTick]);

  // Each action's hold, quoted once with a stand-in for what it needs.
  useEffect(() => {
    if (!articleId || !editable) return undefined;
    let live = true;
    const stand = { brief: 'The article', heading: 'Section', selection: 'This sentence.', cursor_context: 'This sentence.' };
    for (const a of ARTICLE_ACTIONS) {
      const input = a.needs === 'brief' ? { brief: stand.brief }
        : a.needs === 'heading' ? { heading: stand.heading }
          : a.needs === 'selection' ? { selection: stand.selection, tone: 'shorter' }
            : a.needs === 'cursor' ? { cursor_context: stand.cursor_context } : {};
      articleAuthoringApi.quote(articleId, a.option, input)
        .then((q) => { if (live) setQuotes((prev) => ({ ...prev, [a.option]: q })); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [articleId, editable]);

  const run = useCallback(async (option) => {
    setError(null);
    const ctx = getContext?.() || {};
    const built = assistInput(option, { brief, heading, tone, selection: ctx.selection || '', cursorContext: ctx.cursorContext || '' });
    if (built.error) { setError({ text: built.error }); return; }
    setRunning(option);
    try {
      const q = await articleAuthoringApi.quote(articleId, option, built.input);
      if (q && q.ai === false) { setError({ text: q.message || 'Eadwyn cannot run here right now.' }); return; }
      const r = await articleAuthoringApi.assist(articleId, option, built.input, railPressHeaders(option));
      const range = option === 'rewrite:article' ? { start: ctx.start, end: ctx.end } : null;
      setItems((prev) => [{ proposal: r.proposal, cost: r.cost, hold: q?.hold_microusd, range, at: ctx.end }, ...prev]);
    } catch (e) {
      reportError('ArticleWritingPanel:run', e);
      setError(refusalMessage(e));
    } finally {
      setRunning(null);
    }
  }, [articleId, brief, heading, tone, getContext]);

  // A field's Ask (the publish sheet's blank search title or description) opens the panel on its option.
  useEffect(() => {
    if (autoRun && editable) run(autoRun);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const decide = useCallback(async (item, decision) => {
    setBusy(true);
    try {
      await railProposalsApi.decide(item.proposal.uid, decision);
    } catch (e) {
      // A proposal decided elsewhere is gone either way.
      if (e?.status !== 409) { reportError('ArticleWritingPanel:decide', e); setError(refusalMessage(e)); setBusy(false); return false; }
    }
    setItems((prev) => prev.filter((x) => x.proposal.uid !== item.proposal.uid));
    setBusy(false);
    return true;
  }, []);

  const place = async (item, mode) => { if (await decide(item, 'accept')) onPlace(item, mode); };
  const seo = async (item) => { if (await decide(item, 'accept')) onApplySeo(item.proposal.payload || {}); };
  const headline = async (item, h) => { if (await decide(item, 'accept')) onApplyHeadline(h); };

  const where = focus.selection ? 'Selected text' : focus.section ? `Section · ${focus.section}` : 'Whole article';

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 max-h-[75vh] rounded-t-2xl shadow-2xl lg:static lg:z-auto lg:max-h-none lg:rounded-none lg:shadow-none w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col" aria-label="Eadwyn writing panel" data-testid="article-writing-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Eadwyn · Articles · Writing</div>
          <div className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-600" /> Ask</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the writing panel" className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <section>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Working on</div>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" data-testid="article-working-on">{where}</span>
        </section>

        {waitingUnread && (
          <div role="status" className="text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-600 dark:text-slate-300" data-testid="article-proposals-unread">
            Some waiting proposals could not be read. <button type="button" className="underline" onClick={() => setReadTick((n) => n + 1)}>Try again</button>
          </div>
        )}

        {items.length > 0 && (
          <section>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Proposals · {items.length} waiting</div>
            <ul className="space-y-2">
              {items.map((it) => (
                <ProposalCard key={it.proposal.uid} item={it} editable={editable} busy={busy}
                  onPlace={place} onDiscard={(x) => decide(x, 'discard')} onApplySeo={seo} onApplyHeadline={headline} />
              ))}
            </ul>
          </section>
        )}

        {error && (
          <div role="alert" className="text-xs rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-3 py-2" data-testid="article-assist-refusal">
            {error.text}{error.topUp && <> <a href="/account/usage/ai-tokens" className="underline">Add tokens</a></>}
          </div>
        )}

        {editable ? (
          <section>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Actions</div>
            <label className="block text-xs text-slate-500 mb-1" htmlFor="article-brief">Brief (for an outline or a section)</label>
            <input id="article-brief" value={brief} onChange={(e) => setBrief(e.target.value.slice(0, 1000))} placeholder="What is this article about?" className="w-full text-sm px-2 py-1.5 mb-2 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900" />
            <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {ARTICLE_ACTIONS.map((a) => {
                const q = quotes[a.option];
                return (
                  <li key={a.option} className="px-3 py-2.5" data-testid="article-action">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{a.label}</div>
                        <div className="text-[11px] text-slate-500">{a.sub}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5" data-testid="article-action-hold">
                          {q && q.ai === false ? (q.message || 'Not available here right now') : holdsLine(q?.hold_microusd)}
                        </div>
                      </div>
                      <button type="button" onClick={() => run(a.option)} disabled={!!running || (q && q.ai === false)}
                        className="shrink-0 text-xs px-2.5 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
                        {running === a.option ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Run
                      </button>
                    </div>
                    {a.option === 'rewrite:article' && (
                      <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Tone">
                        {REWRITE_TONES.map((t) => (
                          <button key={t.key} type="button" role="radio" aria-checked={tone === t.key} onClick={() => setTone(t.key)}
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${tone === t.key ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-700'}`}>{t.label}</button>
                        ))}
                      </div>
                    )}
                    {a.option === 'draft:article-section' && (
                      <input value={heading} onChange={(e) => setHeading(e.target.value.slice(0, 200))} placeholder="Section heading" aria-label="Section heading"
                        className="mt-2 w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900" />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="text-xs text-slate-500">This article is with the review team or published, so Eadwyn proposes nothing for it now.</p>
        )}
      </div>
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
        Nothing goes into your article until you press Insert or Replace. The text and image models are chosen in the AIRail.
      </div>
    </aside>
  );
}

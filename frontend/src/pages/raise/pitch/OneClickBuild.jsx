import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { connectorsApi } from '../../../lib/api/connectors';
import { deckEditorApi } from '../../../lib/api/deckEditor';
import { deckImagesApi } from '../../../lib/api/deckImages';
import { newDeckApi } from '../../../lib/api/newDeck';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage';
import { Lightbox } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import BuildProgress, { BuildAnnouncer } from './BuildProgress';
import { BlockGrid, gridBlocks } from './BlockGrid';
import { ACCEPT_ALL, DISCARD, HOLD } from './deckV2Model';
import { THEME_LABELS, cardColours } from './editorModel';
import { placeImage } from './imageModel';
import {
  DISCARD_SENTENCE, FAST_TITLE, NEW_PATH, NOT_ON_STUDIOOS, PROPOSAL_LINE, TITLES_ONLY_LINE, aiTokens, buildSentence, fastBrief, fastPathLine, refusalOf,
} from './newDeckModel';
import {
  ACCEPT_ALL_PRESENT, ACCEPT_LINE, ACCEPT_THEME_LINE, ALREADY_KEPT, FAST_LINE, FAST_UNREAD, KIT_UNREAD, LEFT_OUT, NOTHING_TICKED, PROPOSED, REVIEW_TITLE, SAVED_LINE,
  SAVED_THEMED_LINE, THEME_FAILED,
  acceptBody, buildingLine, defaultTicks, flipTick, freshnessRows, imageAsk, imagesHold, imagesOffer, keptAlready, leftOut, readableOverlay, readyLine, reviewCards,
  themeChoices, themePick, themeToWrite,
} from './oneClickModel';
import { presentHref } from './presentExportModel';
import { EDIT_PATH, STUDIO_PATH } from './pitchStudioModel';

/**
 * D1604 (#3716, pd1, pd2b, pd2c, plan §3) — "Generate from my data", the
 * one-click, and the proposal review it lands on.
 *
 *   OneClickBuild   the brief from the context read (#3877's `inferred`, else
 *                   `fast_path`; never a literal of the client's), the quote,
 *                   the connectors' freshness with Sync now, then Build:
 *                   a dialog that says what it does and holds, the build
 *                   (`POST /api/decks/generate`, rail option deck:build) with
 *                   BuildProgress while it runs, and the review. Drawn on the
 *                   studio's home (Start from) and on top of New deck, where
 *                   it builds with the page's own audience, length and sources.
 *   ProposalReview  "Your deck · Proposed": every card drawn on The Grid in the
 *                   theme it will carry, each ticked unless its only content
 *                   is "Not recorded on StudioOS yet" (the missing-data cut,
 *                   `oneClickModel.js`), the "Left out · add data to include"
 *                   list with where to record each figure, the theme line with
 *                   Change, the ready line, then Accept all, Accept all and
 *                   present, and Discard. Accept keeps the ticked cards as the
 *                   new version in one press (`keep-slides` with `save`), then
 *                   writes the picked theme (`PUT /api/decks/:id`) when it
 *                   differs from the version's, which saves one more version,
 *                   and the review says so before the press. A card the
 *                   proposal already kept is locked in ("Already kept"): main's
 *                   keep-slides saves it whatever is sent. Nothing is saved
 *                   before Accept.
 *                   New deck's outline build lands here too.
 *   ImagesOffer     after Accept: the images plan (`GET /api/decks/:id/images/plan`),
 *                   "Add pictures to N cards", one quote per card summed into
 *                   one hold line, then each picture as a proposal with Accept
 *                   all and Discard. Accept keeps them as card backgrounds and
 *                   saves the version once.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50 dark:disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const LAV = 'rounded-[12px] border border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-950/30';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const SMALL = 'text-[11.5px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const SELECT = 'rounded-[8px] border border-axal-hairline bg-white px-2 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** Where a built proposal is reviewed: New deck, reopened on it. */
export const reviewHref = (q, id) => `${NEW_PATH}${q}${q ? '&' : '?'}proposal=${encodeURIComponent(id)}`;

/** A refusal in the Worker's words, with its plan link ("See plans") and its top-up, as `refusalOf` gives them. */
export function RefusalLine({ refusal, testId }) {
  if (!refusal) return null;
  return (
    <span role="alert" className="text-[12px] font-semibold text-axal-violet dark:text-violet-300" data-testid={testId}>
      {refusal.message}{' '}
      {refusal.link ? <Link to={refusal.link.href} className="underline">{refusal.link.text}</Link> : null}
      {refusal.topUp ? <a href={refusal.topUp.href} className="underline">{refusal.topUp.text}</a> : null}
    </span>
  );
}

/**
 * #3877's freshness: each connector the deck reads, as of when, and Sync now
 * on one that is out of date. Drawn only when the context read carries it.
 */
export function FreshnessLines({ ctx, testId = 'pitch-fresh' }) {
  const rows = freshnessRows(ctx);
  const [state, setState] = useState({});
  if (!rows.length) return null;
  const sync = async (r) => {
    setState((s) => ({ ...s, [r.provider]: 'busy' }));
    try { await connectorsApi.sync(r.uid); setState((s) => ({ ...s, [r.provider]: 'started' })); } catch (e) { setState((s) => ({ ...s, [r.provider]: 'failed' })); reportError('pitch-oneclick:sync', e); }
  };
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Connectors" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.provider} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]" data-testid={`${testId}-${r.provider}`}>
          <span className={r.stale ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}>{r.line}</span>
          {r.stale && r.uid && state[r.provider] !== 'started' ? (
            <button type="button" className={LINK} disabled={state[r.provider] === 'busy'} onClick={() => sync(r)} data-testid={`${testId}-${r.provider}-sync`}>
              {state[r.provider] === 'busy' ? 'Syncing…' : 'Sync now'}
            </button>
          ) : null}
          {state[r.provider] === 'started' ? <span role="status" className="text-axal-muted dark:text-gray-400">Sync started. Build once it finishes to use the new figures.</span> : null}
          {state[r.provider] === 'failed' ? <span role="alert" className="text-axal-destructive dark:text-red-400">The sync could not start. Try again.</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The one-click. `ctx` is the context read when the page already has it
 * (New deck); without it the component reads it. `brief` overrides the read's
 * brief with the page's own choices; `exclude` is the sources left unticked.
 * `onBuilt(reply)` replaces the default landing on the review.
 */
export default function OneClickBuild({
  projectId, q = '', ctx: given = null, brief: chosen = null, exclude = null, testId = 'pitch-studio-fast', as: Tag = 'li',
  title = FAST_TITLE, line = FAST_LINE, onBuilt = null, children = null,
}) {
  const navigate = useNavigate();
  const [read, setRead] = useState(given ? { status: 'ok', data: given } : { status: 'loading', data: null });
  const [quote, setQuote] = useState(null);
  const [open, setOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const ctx = given || read.data;
  const brief = chosen || (read.status === 'ok' || given ? fastBrief(ctx) : null);
  const ex = Array.isArray(exclude) ? exclude : [];
  const exKey = ex.join(',');
  const busy = startedAt != null;
  // The venture's round, as New deck's own Build sends it: the brief's when the page gives one, else the read's.
  const roundRef = brief && brief.round_ref !== undefined ? brief.round_ref : ctx?.round?.uid ?? null;
  useRailOption(busy ? 'deck:build' : null, 'Build deck');

  useEffect(() => {
    if (given) return undefined;
    let live = true;
    setRead({ status: 'loading', data: null });
    newDeckApi.context(projectId)
      .then((c) => { if (live) setRead({ status: 'ok', data: c }); }, (e) => { if (live) setRead({ status: 'error', data: null }); reportError('pitch-oneclick:context', e); });
    return () => { live = false; };
  }, [projectId, given]);

  useEffect(() => {
    if (!brief) return undefined;
    let live = true;
    newDeckApi.quote({ project_id: projectId, step: 'build', audience: brief.audience, length: brief.length, round_ref: roundRef, ...(ex.length ? { exclude: ex } : {}) })
      .then((qt) => { if (live) setQuote(qt); }, (e) => { if (live) setQuote(null); reportError('pitch-oneclick:quote', e); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, brief?.audience, brief?.length, roundRef, exKey]);

  const titles = useMemo(() => {
    const rows = brief ? ctx?.standard?.[brief.length] : null;
    return Array.isArray(rows) ? rows.map((r) => (typeof r === 'object' && r ? r.title : null)).filter(Boolean) : [];
  }, [ctx, brief?.length]);

  const build = async () => {
    if (!brief) return;
    setStartedAt(Date.now()); setRefusal(null);
    try {
      const r = await newDeckApi.build({ project_id: projectId, audience: brief.audience, length: brief.length, round_ref: roundRef, ...(ex.length ? { exclude: ex } : {}) }, railPressHeaders('deck:build'));
      setOpen(false);
      if (onBuilt) onBuilt(r); else navigate(reviewHref(q, r.proposal.id));
    } catch (e) { setRefusal(refusalOf(e)); setOpen(false); reportError('pitch-oneclick:build', e); } finally { setStartedAt(null); }
  };

  const wrap = Tag === 'li'
    ? 'flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-700'
    : `${LAV} flex flex-wrap items-center justify-between gap-3 p-4`;
  return (
    <Tag className={wrap} data-testid={testId}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[13.5px] font-bold ${INK}`}>{title}</span>
        <span className={MUTED}>{line}</span>
        <span className={SMALL} data-testid={`${testId}-line`}>{fastPathLine(quote, brief)}</span>
        {brief?.why ? <span className={SMALL} data-testid={`${testId}-why`}>{brief.why}</span> : null}
        {read.status === 'error' && !given ? <span className={SMALL} data-testid={`${testId}-unread`}>{FAST_UNREAD}</span> : null}
        {children}
        <FreshnessLines ctx={ctx} testId={`${testId}-fresh`} />
        <RefusalLine refusal={refusal} testId={`${testId}-refusal`} />
      </div>
      <button type="button" className={PRIMARY} onClick={() => setOpen(true)} disabled={!brief}
        aria-busy={read.status === 'loading' && !given ? 'true' : undefined} data-testid={`${testId}-build`}>Build</button>
      {open ? (
        <Lightbox label={title} title={title} width={560} onClose={() => !busy && setOpen(false)} testId={`${testId}-dialog`}
          footer={busy ? null : (
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={build} data-testid={`${testId}-run`}>Build deck</button>
            </div>
          )}>
          {/* Mounted with the dialog and empty until the build starts, so the change is announced. */}
          <BuildAnnouncer text={busy ? buildingLine(brief?.cards ?? null) : ''} testId={`${testId}-announce`} />
          {busy ? <BuildProgress cards={brief?.cards ?? null} titles={titles} startedAt={startedAt} /> : (
            <div className="flex flex-col gap-2">
              <p className={`m-0 ${MUTED}`}>{buildSentence(quote, brief?.cards ?? null)}</p>
              {quote?.ai ? <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-hold`}>{HOLD(aiTokens(quote.hold_microusd))}</span> : null}
            </div>
          )}
        </Lightbox>
      ) : null}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// The review
// ---------------------------------------------------------------------------

/**
 * "Your deck · Proposed" (pd2c, §3.2 steps 6 and 7). `versions` is the
 * versions read's list, for the base version's theme; `items` the sources
 * read's, for where each missing figure is recorded; `built` the build's
 * reply when the page just ran it.
 */
export function ProposalReview({ projectId, q = '', proposal, items = [], versions = [], built = null, audience = null, onSaved = null }) {
  const navigate = useNavigate();
  const [kit, setKit] = useState({ status: 'loading', data: null });
  const [picked, setPicked] = useState(null);
  const cards = useMemo(() => reviewCards(proposal, items), [proposal, items]);
  const locked = useMemo(() => keptAlready(proposal), [proposal]);
  const [ticks, setTicks] = useState(() => defaultTicks(reviewCards(proposal, []), proposal));
  const [busy, setBusy] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    let live = true;
    deckEditorApi.brandKit(projectId).then((d) => { if (live) setKit({ status: 'ok', data: d }); },
      (e) => { if (live) setKit({ status: 'error', data: null }); reportError('pitch-review:brand-kit', e); });
    return () => { live = false; };
  }, [projectId]);

  const base = (versions || []).find((v) => v && String(v.id) === String(proposal?.base_deck_id)) || null;
  const baseTheme = base?.theme ?? null;
  const pick = themePick(baseTheme, kit);
  const theme = picked ? { kind: picked, background: null } : pick?.theme || null;
  const colours = cardColours(theme, kit.data?.kit);
  const out = leftOut(cards, ticks, locked);
  const choices = themeChoices(kit, baseTheme);
  const willWrite = themeToWrite(theme, baseTheme) != null;
  const kept = cards.length - out.length;
  const worded = built?.wording?.by === 'Eadwyn' || (!built && cards.some((c) => {
    const h = (c.slide?.blocks || []).find((b) => b?.kind === 'text' && b.style === 'heading');
    return h?.text && h.text !== c.title;
  }));

  const flip = (i) => setTicks((s) => flipTick(s, i, locked));

  const accept = async (present) => {
    const body = acceptBody(ticks);
    if (!body) return;
    setBusy(present ? 'present' : 'accept'); setRefusal(null);
    try {
      const r = await newDeckApi.keepSlides(proposal.id, body);
      let deck = r?.deck || null;
      if (!deck) throw new Error('The cards could not be saved. Nothing was changed.');
      const write = themeToWrite(theme, baseTheme);
      let themeFailed = false;
      let cardsVersion = null;
      if (write) {
        // Main's keep-slides takes no theme, so the theme is one more version on top (ACCEPT_THEME_LINE).
        cardsVersion = deck.version ?? null;
        try {
          const d = await api.deckUpdate(deck.id, { slides: deck.slides, title: deck.title, theme: write });
          deck = d?.deck || d || deck;
        } catch (e) { themeFailed = true; cardsVersion = null; reportError('pitch-review:theme', e); }
      }
      onSaved?.(deck);
      if (present && !themeFailed) { navigate(presentHref(projectId, deck.id)); return; }
      setSaved({ deck, themeFailed, cardsVersion });
    } catch (e) { setRefusal(refusalOf(e)); reportError('pitch-review:accept', e); } finally { setBusy(null); }
  };

  const discard = async () => {
    setBusy('discard'); setRefusal(null);
    try { await api.deckDiscardProposal(proposal.id); navigate(`${STUDIO_PATH}${q}`); } catch (e) { setRefusal(refusalOf(e)); setDiscarding(false); reportError('pitch-review:discard', e); } finally { setBusy(null); }
  };

  if (saved) {
    return (
      <section className={`${CARD} flex flex-col gap-3 p-4`} aria-label={REVIEW_TITLE} data-testid="pitch-review-saved">
        <span role="status" className={`text-[14px] font-extrabold ${INK}`} data-testid="pitch-review-saved-line">
          {saved.cardsVersion != null ? SAVED_THEMED_LINE(saved.cardsVersion, saved.deck.version ?? '?') : SAVED_LINE(saved.deck.version ?? '?')}
        </span>
        {saved.themeFailed ? <span role="alert" className={MUTED} data-testid="pitch-review-theme-failed">{THEME_FAILED}</span> : null}
        <span className="flex flex-wrap gap-2">
          <Link to={presentHref(projectId, saved.deck.id)} className={PRIMARY} data-testid="pitch-review-present">Present</Link>
          <Link to={`${EDIT_PATH}${q}`} className={GHOST} data-testid="pitch-review-edit">Open in the editor ›</Link>
        </span>
        <ImagesOffer deck={saved.deck} onDeck={(d) => setSaved((s) => ({ ...s, deck: d }))} />
      </section>
    );
  }

  if (!cards.length) {
    return <div className={`${CARD} p-5 ${MUTED}`} role="alert" data-testid="pitch-review-empty">This proposal has no cards yet.</div>;
  }

  return (
    <section className={`${LAV} flex flex-col gap-3 p-4`} aria-label={REVIEW_TITLE} data-testid="pitch-new-proposal">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className={`text-[15px] font-extrabold ${INK}`}>{REVIEW_TITLE}</span>
            <span className={PILL_VIO}>{PROPOSED}</span>
          </span>
          <span className={`text-[12.5px] ${INK}`}><b>{worded ? 'Proposed by Eadwyn.' : 'Built from your records.'}</b> {worded ? PROPOSAL_LINE : TITLES_ONLY_LINE}{audience ? ` For ${audience}.` : ''}</span>
          <span className="flex flex-wrap items-center gap-2 text-[12px]" data-testid="pitch-review-theme">
            <span className={INK}>{picked ? `Theme: ${THEME_LABELS[picked]}` : pick ? pick.line : 'Theme: reading your brand kit…'}</span>
            <label className="flex items-center gap-1.5 text-axal-muted dark:text-gray-400">
              <span>Change</span>
              <select className={SELECT} aria-label="Change the theme" value={theme?.kind || ''} disabled={!pick} onChange={(e) => setPicked(e.target.value || null)} data-testid="pitch-review-theme-change">
                {choices.map((k) => <option key={k} value={k}>{THEME_LABELS[k]}</option>)}
              </select>
            </label>
          </span>
          {pick?.from === 'unread' && !picked ? <span className={SMALL} data-testid="pitch-review-kit-unread">{KIT_UNREAD}</span> : null}
          <span className={`text-[12.5px] font-semibold ${INK}`} data-testid="pitch-review-ready">{readyLine(kept, out.length)}</span>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="flex flex-wrap justify-end gap-1.5">
            <button type="button" className={PRIMARY} onClick={() => accept(true)} disabled={!kept || Boolean(busy)} data-testid="pitch-review-accept-present">
              {busy === 'present' ? 'Saving…' : ACCEPT_ALL_PRESENT}
            </button>
            <button type="button" className={GHOST} onClick={() => accept(false)} disabled={!kept || Boolean(busy)} data-testid="pitch-review-accept">
              {busy === 'accept' ? 'Saving…' : `${ACCEPT_ALL} (${kept})`}
            </button>
            <button type="button" className={GHOST} onClick={() => setDiscarding(true)} disabled={Boolean(busy)} data-testid="pitch-review-discard">{DISCARD}</button>
          </span>
          <span className={`${SMALL} max-w-[360px] text-right`} data-testid="pitch-review-accept-line">{kept ? (willWrite ? ACCEPT_THEME_LINE : ACCEPT_LINE) : NOTHING_TICKED}</span>
        </div>
      </div>
      <RefusalLine refusal={refusal} testId="pitch-review-refusal" />
      {built?.cost?.charged_microusd != null ? (
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-review-charged">The build used {aiTokens(built.cost.charged_microusd)} in AI tokens. Nothing more is charged to accept it.</span>
      ) : null}
      <ol className="m-0 grid list-none items-stretch gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {cards.map((c) => {
          const on = ticks.has(c.index) || locked.has(c.index);
          const fixed = locked.has(c.index);
          const blocks = gridBlocks(c.slide);
          return (
            <li key={c.index} className={`${CARD} flex flex-col gap-2 p-2.5 ${on ? '' : 'opacity-60'}`} data-testid={`pitch-review-card-${c.index}`}>
              <div className="relative aspect-video overflow-hidden rounded-[6px] border border-axal-hairline dark:border-gray-700" style={{ background: colours.bg, color: colours.ink }} aria-hidden="true">
                {blocks.length ? <BlockGrid blocks={blocks} colours={colours} testId={`pitch-review-blocks-${c.index}`} /> : (
                  <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-[13px] font-bold">{c.title}</span>
                )}
              </div>
              <label className="flex items-start gap-2 text-[12px]">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-axal-violet disabled:opacity-60 dark:disabled:opacity-60" checked={on} disabled={fixed} onChange={() => flip(c.index)}
                  aria-label={`Include card ${c.n} · ${c.title}`} data-testid={`pitch-review-tick-${c.index}`} />
                <span className="flex min-w-0 flex-col">
                  <span className={`font-semibold ${INK}`}><span className="font-mono text-axal-muted dark:text-gray-400">{c.n}</span> {c.title}</span>
                  {fixed ? <span className={SMALL} data-testid={`pitch-review-kept-${c.index}`}>{ALREADY_KEPT}</span> : null}
                  {c.emptyOnly ? <span className={SMALL}>Nothing on this card is recorded yet.</span> : null}
                  {c.partial ? <span className={SMALL} data-testid={`pitch-review-partial-${c.index}`}>A figure here is not recorded: it reads {NOT_ON_STUDIOOS}, never 0.</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ol>
      {out.length ? (
        <section className={`${CARD} flex flex-col gap-2 p-3.5`} aria-label={LEFT_OUT} data-testid="pitch-review-left-out">
          <span className={`text-[13px] font-extrabold ${INK}`}>{LEFT_OUT}</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {out.map((c) => (
              <li key={c.index} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" data-testid={`pitch-review-left-${c.index}`}>
                <span className={INK}><span className="font-mono text-axal-muted dark:text-gray-400">{c.n}</span> {c.title}</span>
                {c.gaps.length ? c.gaps.map((g) => (g.href ? (
                  <Link key={g.key} to={g.href} className={LINK}>{`Add ${g.label}${g.module ? ` in ${g.module}` : ''} ›`}</Link>
                ) : <span key={g.key} className={PILL_MU}>{`${g.label} · ${NOT_ON_STUDIOOS}`}</span>)) : <span className={SMALL}>You unticked it.</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {discarding ? (
        <Lightbox label="Discard this proposal" title="Discard this proposal" width={480} onClose={() => !busy && setDiscarding(false)} testId="pitch-review-discard-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setDiscarding(false)} disabled={Boolean(busy)}>Cancel</button>
              <button type="button" className={`${BTN} bg-axal-destructive text-white hover:opacity-90 dark:bg-red-600 dark:text-white`} onClick={discard} disabled={Boolean(busy)} data-testid="pitch-review-discard-confirm">{busy === 'discard' ? 'Discarding…' : DISCARD}</button>
            </div>
          )}>
          <p className={`m-0 ${MUTED}`}>{DISCARD_SENTENCE}</p>
        </Lightbox>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pictures, after Accept
// ---------------------------------------------------------------------------

/**
 * §3.2 step 8: the images plan on the saved version. Nothing is drawn until
 * the founder asks; each picture is then a proposal, kept only on Accept.
 */
export function ImagesOffer({ deck, onDeck }) {
  const [plan, setPlan] = useState({ status: 'loading', data: null });
  const [stage, setStage] = useState('idle');
  const [quotes, setQuotes] = useState(null);
  const [drawn, setDrawn] = useState([]);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);
  useRailOption(stage === 'running' ? 'deck:image' : null, 'Generate');

  useEffect(() => {
    let live = true;
    deckImagesApi.plan(deck.id).then((d) => { if (live) setPlan({ status: 'ok', data: d }); },
      (e) => { if (live) setPlan({ status: 'error', data: null }); reportError('pitch-review:images-plan', e); });
    return () => { live = false; };
  // The plan is read once for the version Accept saved; a version the pictures save is not re-planned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offer = plan.status === 'ok' ? imagesOffer(plan.data) : null;
  if (plan.status !== 'ok' || !offer) return null;
  if (offer.off) return <span className={SMALL} data-testid="pitch-images-off">{offer.line}</span>;
  const direction = plan.data.direction;

  const price = async () => {
    setStage('quoting'); setRefusal(null);
    try {
      const qs = await Promise.all(offer.cards.map((c) => deckImagesApi.quote(deck.id, imageAsk(c, direction))));
      setQuotes(qs); setStage('quoted');
    } catch (e) { setRefusal(refusalOf(e)); setStage('idle'); reportError('pitch-review:images-quote', e); }
  };

  const generate = async () => {
    setStage('running'); setRefusal(null);
    const got = [];
    for (const c of offer.cards) {
      try {
        // Each card is its own run and its own charge; a refusal stops the rest.
        const r = await deckImagesApi.generate(deck.id, imageAsk(c, direction), railPressHeaders('deck:image'));
        for (const image of r?.images || []) got.push({ index: c.index, image });
        if (r?.stopped) break;
      } catch (e) { setRefusal(refusalOf(e)); reportError('pitch-review:images-generate', e); break; }
    }
    setDrawn(got); setStage(got.length ? 'proposed' : 'idle');
  };

  const keepAll = async () => {
    setStage('keeping'); setRefusal(null);
    try {
      const overlay = readableOverlay();
      let slides = Array.isArray(deck.slides) ? deck.slides.slice() : [];
      for (const { index, image } of drawn) {
        const r = await deckImagesApi.keep(image.uid, { use: 'card', overlay });
        const placed = placeImage({ card: slides[index], theme: deck.theme }, r?.image || image, 'card');
        if (placed.card) slides = slides.map((s, i) => (i === index ? placed.card : s));
      }
      const d = await api.deckUpdate(deck.id, { slides, title: deck.title });
      const next = d?.deck || d || deck;
      onDeck?.(next); setDone(next); setDrawn([]); setStage('done');
    } catch (e) { setRefusal(refusalOf(e)); setStage('proposed'); reportError('pitch-review:images-keep', e); }
  };

  const discardAll = async () => {
    setStage('keeping');
    for (const { image } of drawn) {
      try { await deckImagesApi.discard(image.uid); } catch (e) { reportError('pitch-review:images-discard', e); }
    }
    setDrawn([]); setStage('idle');
  };

  const hold = imagesHold(quotes);
  return (
    <section className={`${CARD} flex flex-col gap-2 p-3.5`} aria-label="Pictures" data-testid="pitch-images-offer">
      <span className={`text-[13px] font-extrabold ${INK}`}>{offer.line}</span>
      <span className={SMALL}>One illustration style for the whole deck, in its palette. No text, figures or people go into a picture.</span>
      {stage === 'idle' || stage === 'quoting' ? (
        <button type="button" className={`${GHOST} self-start`} onClick={price} disabled={stage === 'quoting'} data-testid="pitch-images-price">{stage === 'quoting' ? 'Pricing…' : 'See the price'}</button>
      ) : null}
      {stage === 'quoted' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-images-hold">{hold || (quotes?.find((x) => x?.ai === false)?.message || 'The price could not be worked out.')}</span>
          {hold ? <button type="button" className={PRIMARY} onClick={generate} data-testid="pitch-images-generate">Generate</button> : null}
        </div>
      ) : null}
      {stage === 'running' ? <span role="status" className={MUTED}>Drawing the pictures, one card at a time…</span> : null}
      {drawn.length && (stage === 'proposed' || stage === 'keeping') ? (
        <>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4" data-testid="pitch-images-proposed">
            {drawn.map(({ index, image }) => (
              <li key={image.uid} className="flex flex-col gap-1">
                <img src={image.url} alt={image.alt || ''} className="aspect-video w-full rounded-[6px] object-cover" />
                <span className="flex items-center justify-between gap-1 text-[11px]"><span className={INK}>Card {String(index + 1).padStart(2, '0')}</span><span className={PILL_VIO}>{PROPOSED}</span></span>
              </li>
            ))}
          </ul>
          <span className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={keepAll} disabled={stage === 'keeping'} data-testid="pitch-images-accept">{ACCEPT_ALL}</button>
            <button type="button" className={GHOST} onClick={discardAll} disabled={stage === 'keeping'} data-testid="pitch-images-discard">{DISCARD}</button>
          </span>
        </>
      ) : null}
      {stage === 'done' && done ? <span role="status" className={MUTED} data-testid="pitch-images-done">{`The pictures are on the cards, saved as v${done.version ?? '?'}.`}</span> : null}
      <RefusalLine refusal={refusal} testId="pitch-images-refusal" />
    </section>
  );
}


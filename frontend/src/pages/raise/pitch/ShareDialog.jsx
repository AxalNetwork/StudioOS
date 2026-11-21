import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { cyclesWrite } from '../../../lib/api/cycles';
import { deckCommentsApi } from '../../../lib/api/deckComments.js';
import { cardStatus, walkthrough as readWalkthrough } from './deckV2Adapter';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import InvestorLinksTable, { versionWords, viewsWords } from './InvestorLinksTable.jsx';
import DeckPreview from './DeckPreview.jsx';
import { deckRecordingsApi } from '../../../lib/api/deckRecordings.js';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { WALK_ATTACHED, WALK_NOT_ATTACHED, recordHref, walkthroughOption } from './walkthroughModel.js';
import PublishPanel from './PublishPanel.jsx';
import { preShareGate } from './commentsModel';
import { statusLabel } from './cardStatusModel';
import { OFF_KEEPS, TIME_PER_SLIDE } from './slideAnalyticsModel.js';
import { effectiveDeck } from './preflightUiModel';
import { GateBody, PreflightMeasure } from './PreflightPanel';
import useSendCheck from './useSendCheck';
import {
  DEFAULT_SHARE, EXPIRIES, INCLUDE_ROWS, NDA_SWITCH, NEVER_SHARED, NO_LIMIT, SHARE_CTA, SHARE_TITLE, SHOWN_ONCE, TYPED,
  frozenLine, shareBody, shareFailure, shareProblem, shareUrl, whatShareDoes,
  THIS_VERSION, VARIANTS_UNREAD, WATERMARK_LINE, linkTargets, variantOf,
  DOWNLOAD_LINE, FORWARDING_LINE, FROZEN_NOTE, NDA_LINE, ONE_LINK_EACH, PREVIEW_NOTE, TIME_LINE,
  includedLine, linkStatusLine, linksButton, linksForInvestor, recipientName, recipientPreview,
} from './shareModel';
import { deckInvestorLinksApi } from '../../../lib/api/deckInvestorLinks';
import { deckPreflightApi } from '../../../lib/api/deckPreflight';

/**
 * D902 (#2681) — the share dialog (PD18), from Share in the editor and from
 * "New link" on Share & analytics. It writes through the one link writer,
 * `POST /api/cycles/raise/deck-links`, and says what it writes before it
 * writes it. The link is shown once, with Copy. D1564 (#3811): under it,
 * the one publish control (`PublishPanel.jsx`).
 *
 * D1570 (#3817): Share opens a single gate. Before the link is written, the
 * pre-share confirm (pd34's, which pd33's inset joins) reads who must approve
 * this version (`GET /api/decks/:id/approval`). While an approver has not, it
 * shows the amber "Approval needed before sharing · [name] has not approved
 * yet" and holds Share: the Worker refuses the link until they sign off, so
 * there is no way past it.
 *
 * D1579 (#3826, pd34): the same confirm reads the version's card status
 * (`deckV2Adapter.cardStatus`) beside the approval, and while any card is not
 * Done it shows the inset "[n] cards are not Done. Share anyway?" listing
 * them, with Review cards (back to the editor, on the first of them) and
 * Share. That line warns and never holds: Share passes it, unless an approver
 * is also waited on. One gate, one Share.
 *
 * D1573 (#3820, pd35's row editor): the new link's "Time per slide" switch,
 * on by default; off sends `time_per_slide: false`, and the link then keeps
 * visit counts only ("Off keeps visit counts only").
 *
 * #4272 (ps7n): "Version or variant". The link shows this version, or one of
 * its tailored variants (`GET /api/decks/:id/variants`). A variant's link is
 * made by `POST /api/decks/:id/investor-links` with `variant_uid`, which calls
 * the same one link writer and then sets the variant. The watermark row is
 * drawn on and fixed: every link names its investor (D1565), so it is never a
 * choice. A failed variants read still offers this version, and says so.
 *
 * D4598 (#4598) part 2 — the check before the link is made now reads the link's
 * OWN effective content: this version's cards in the picked variant's order
 * (D1565), less what "What is included" leaves out — not the saved version as a
 * whole, which may show a card the link itself would never send, or miss a
 * problem on a card only a variant's reordering, or dropping the Sources
 * appendix, brings forward. `POST /api/decks/:id/preflight/link-cards` computes
 * that content the same way `linkSentCards` does for a link once it exists
 * (`deck_preflight.ts`, `decks.ts`'s `effectiveSlidesFor`), so the check here and
 * the card a reaction later attributes never drift apart. Picking another
 * variant, or flipping "What is included", is a new combination: the earlier
 * check no longer counts, and this one re-runs before Create link — which stays
 * disabled until it is clean, or its warnings are confirmed through "Send
 * anyway" (`useSendCheck`, shared with `ExportDialog.jsx`'s own check).
 *
 * D6061 (#6061, Pitch Studio v2 PS-07): the dialog is the investor-first Share
 * page. One investor at a time, in three numbered parts (1 · Investor, 2 · What
 * they get, 3 · Access), with every option the dialog offered before, and
 * beside them "What [name] will receive": the viewer's own header and frozen
 * note, the NDA step, the first card the link would send with the watermark
 * under it, and what the investor can and cannot do. The preview is drawn from
 * the same two inputs the link is made from: this form's state (the body
 * `shareBody` writes) and the cards `POST …/preflight/link-cards` answers for
 * the chosen variant and "What is included" — the selection the link serves
 * (`effectiveSlidesFor`). The links table moves behind "Investor links (n)";
 * the chosen investor's own links on this version, live until a day,
 * withdrawn or expired, show in part 1. The Walkthrough row reads HQ's
 * `deck:walkthrough` switch and the takes as they are: Not switched on yet,
 * could not be read, not recorded, or Attach, which attaches the takes to the
 * new link once it exists. Below 1024px the preview folds under one line
 * ("v7 · NDA first · no download").
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-60`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'min-h-[34px] rounded-[8px] border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';
const PART = 'flex min-w-0 flex-col gap-3 rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const PART_TITLE = `m-0 text-[13.5px] font-extrabold ${INK}`;
const SUB = 'block text-[11.5px] font-normal leading-[1.4] text-axal-muted dark:text-gray-400';

function Toggle({ label, sub = null, on, onChange, testId }) {
  return (
    <label className={`flex min-h-[44px] items-center justify-between gap-3 text-[12.5px] sm:min-h-0 ${INK}`}>
      <span className="min-w-0"><span className="font-semibold">{label}</span>{sub ? <span className={SUB}>{sub}</span> : null}</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );
}

/** One numbered part of the page: "1 · Investor", "2 · What they get", "3 · Access". */
function Part({ title, testId, children }) {
  return (
    <section className={PART} aria-label={title} data-testid={testId}>
      <h3 className={PART_TITLE}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * D6061 (PS-07): "What [name] will receive", from `recipientPreview` and the link's own cards. The first card
 * is drawn by the same card renderer the studio's previews use, from the slides the link would serve; nothing
 * here is a sample. Folded under its summary line below 1024px, open beside the form above it.
 */
function RecipientPreview({ preview, content, failed, origin }) {
  const [open, setOpen] = useState(false);
  const first = Array.isArray(content?.slides) && content.slides.length ? { slides: content.slides, theme: content.theme } : null;
  return (
    <section className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0" aria-labelledby="pitch-share-preview-title" data-testid="pitch-share-preview">
      <button type="button" className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[10px] border border-axal-hairline bg-white px-3 text-left hover:bg-axal-ground lg:hidden dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800 ${INK}`}
        aria-expanded={open} aria-controls="pitch-share-preview-body" onClick={() => setOpen((o) => !o)} data-testid="pitch-share-preview-toggle">
        <span className="min-w-0"><b className="block text-[12.5px]">{`Preview ${preview.title.replace(/^What /, 'what ')}`}</b><span className={SUB}>{preview.summary}</span></span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div id="pitch-share-preview-body" className={`${open ? 'flex' : 'hidden'} min-w-0 flex-col gap-3 lg:flex`}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="pitch-share-preview-title" className={PART_TITLE}>{preview.title}</h3>
          <span className="font-mono text-[10.5px] text-axal-muted dark:text-gray-400">exact preview</span>
        </div>
        <div className="overflow-hidden rounded-[12px] border border-axal-hairline dark:border-gray-700">
          <div className="flex items-center gap-1.5 border-b border-axal-hairline bg-axal-ground px-3 py-2 font-mono text-[10.5px] text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400" aria-hidden="true">
            <i className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" /><i className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" /><i className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
            <span className="ml-1 truncate">{`${origin}/share/deck/…`}</span>
          </div>
          <div className="flex flex-col gap-2.5 bg-gray-100 p-3 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="rounded-[10px] border border-gray-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900" data-testid="pitch-share-preview-header">
              <b className="block truncate text-[12.5px]">{preview.header}</b>
              {preview.frozen ? <span className="block text-[11px] text-gray-500 dark:text-slate-400">{preview.frozen}</span> : null}
              {preview.gate ? <span className="mt-1 block text-[11.5px] font-semibold text-gray-700 dark:text-slate-300" data-testid="pitch-share-preview-gate">{`Step 1 · ${preview.gate}`}</span> : null}
            </div>
            {failed ? (
              <span className="flex aspect-video w-full items-center justify-center rounded-[6px] border border-gray-200 bg-white p-3 text-center text-[12px] text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400" data-testid="pitch-share-preview-unread">The cards could not be read, so nothing is previewed.</span>
            ) : first ? (
              <DeckPreview deck={first} slideIndex={0} cacheKey={null} />
            ) : (
              <span className="flex aspect-video w-full animate-pulse items-center justify-center rounded-[6px] bg-gray-200 text-[12px] text-gray-500 dark:bg-slate-800 dark:text-slate-400">{content ? 'This link would send no card.' : 'Reading the cards…'}</span>
            )}
            {preview.watermark ? <span className="text-[10.5px] text-gray-500 dark:text-slate-400" data-testid="pitch-share-preview-watermark">{preview.watermark}</span> : null}
            <div className="flex flex-wrap justify-between gap-2 font-mono text-[10.5px] text-gray-500 dark:text-slate-400">
              <span data-testid="pitch-share-preview-cards">{preview.cards}</span>
              <span data-testid="pitch-share-preview-limits">{preview.limits}</span>
            </div>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]" data-testid="pitch-share-preview-rights">
          <dt className="text-axal-muted dark:text-gray-400">Sees</dt><dd className={`m-0 font-semibold ${INK}`}>{preview.sees}</dd>
          <dt className="text-axal-muted dark:text-gray-400">Can</dt><dd className={`m-0 font-semibold ${INK}`} data-testid="pitch-share-preview-can">{preview.can.join(' · ')}</dd>
          <dt className="text-axal-muted dark:text-gray-400">Cannot</dt><dd className={`m-0 font-semibold ${INK}`} data-testid="pitch-share-preview-cannot">{preview.cannot.length ? preview.cannot.join(' · ') : 'Nothing is held back by this link'}</dd>
          <dt className="text-axal-muted dark:text-gray-400">You see</dt><dd className={`m-0 font-semibold ${INK}`}>{preview.timing}</dd>
        </dl>
        <p className={`m-0 ${MUTED}`}>{PREVIEW_NOTE}</p>
      </div>
    </section>
  );
}

export default function ShareDialog({ projectId, deck, kit = null, refresh = null, onClose, onCreated, onReviewCards = null }) {
  const [state, setState] = useState({ ...DEFAULT_SHARE, include: { ...DEFAULT_SHARE.include } });
  const [prospects, setProspects] = useState({ status: 'loading', rows: [] });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  // D1570: the pre-share confirm, while it is open; null when Share goes straight through.
  const [gate, setGate] = useState(null);
  // #4272 (ps7n): this version's tailored variants, for "Version or variant".
  const [variants, setVariants] = useState({ status: 'loading', rows: [] });
  // D6061 (PS-07): the links read the table makes (for "Investor links (n)" and part 1), whether the table is
  // open, the walkthrough read, the founder's Attach choice and what attaching answered once the link exists.
  const [links, setLinks] = useState(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [walk, setWalk] = useState(null);
  const [attachWalk, setAttachWalk] = useState(false);
  const [walkDone, setWalkDone] = useState(null);
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  const loadWalk = useCallback(() => {
    if (!deck?.id) return;
    setWalk(null);
    readWalkthrough(deck.id).then(setWalk);
  }, [deck?.id]);
  useEffect(() => { loadWalk(); }, [loadWalk]);
  const walkOption = walkthroughOption(walk);

  useEffect(() => {
    let alive = true;
    cyclesWrite.formOptions('raise', projectId, 'pitch-deck')
      .then((r) => {
        if (!alive) return;
        const rows = Array.isArray(r?.prospects) ? r.prospects : [];
        setProspects({ status: 'ok', rows });
        setState((s) => (s.investor ? s : { ...s, investor: rows[0]?.value ?? TYPED }));
      })
      .catch((e) => {
        reportError('ShareDialog:prospects', e);
        if (!alive) return;
        setProspects({ status: 'error', rows: [] });
        setState((s) => (s.investor ? s : { ...s, investor: TYPED }));
      });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    if (!deck?.id) return undefined;
    deckInvestorLinksApi.deckVariants(deck.id)
      .then((r) => { if (alive) setVariants({ status: 'ok', rows: Array.isArray(r?.variants) ? r.variants : [] }); })
      .catch((e) => {
        if (e?.status !== 404) reportError('ShareDialog:variants', e);
        if (alive) setVariants({ status: 'error', rows: [] });
      });
    return () => { alive = false; };
  }, [deck?.id]);
  const targets = linkTargets(deck, variants.rows);
  const variantUid = variantOf(state.target);
  const variantName = variantUid ? variants.rows.find((v) => v.uid === variantUid)?.name ?? null : null;

  // D4598 (#4598) part 2: the link's own effective content — this version's cards in the
  // picked variant's order, less what "What is included" leaves out — read fresh for each
  // combination and cached by it, so switching back to one already read never re-reads it.
  const comboKey = `${variantUid || ''}::${JSON.stringify(state.include)}`;
  const [contentByCombo, setContentByCombo] = useState({});
  const [contentFailedKey, setContentFailedKey] = useState(null);
  const [contentTry, setContentTry] = useState(0);
  useEffect(() => {
    if (!deck?.id || contentByCombo[comboKey]) return undefined;
    let live = true;
    setContentFailedKey(null);
    deckPreflightApi.linkCards(deck.id, { variantUid, include: state.include }).then((r) => {
      if (!live) return;
      setContentByCombo((m) => (m[comboKey] ? m : {
        ...m, [comboKey]: { slides: Array.isArray(r?.slides) ? r.slides : [], theme: r?.theme ?? null, version: r?.version ?? deck.version ?? null },
      }));
    }, (e) => {
      reportError('ShareDialog:linkCards', e);
      if (live) setContentFailedKey(comboKey);
    });
    return () => { live = false; };
  }, [deck?.id, comboKey, contentTry]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkContent = contentByCombo[comboKey] || null;
  const linkContentFailed = contentFailedKey === comboKey && !linkContent;
  const eDeck = useMemo(() => effectiveDeck(deck?.id, linkContent?.version, linkContent?.slides, linkContent?.theme), [deck?.id, linkContent]);
  const send = useSendCheck({ kind: 'share', deck: eDeck, kit, refresh });
  // D4598 part 2: "Send anyway" is this check's own confirm — it unblocks Create link, it
  // does not create the link by itself.
  const sendAnyway = () => send.confirm();

  const problem = shareProblem(state, deck);
  const investorName = state.investor === TYPED ? String(state.label || '').trim() : prospects.rows.find((p) => String(p.value) === String(state.investor))?.label;
  const url = shareUrl(made);
  const who = recipientName(investorName);
  const linkRows = links?.available ? (Array.isArray(links.value?.links) ? links.value.links : []) : null;
  const theirs = linkRows ? linksForInvestor(linkRows, state) : [];
  const attaching = attachWalk && walkOption.kind === 'ready';
  const preview = recipientPreview({
    state, deck, investorName, variantName, content: linkContent, contentFailed: linkContentFailed, walkthrough: attaching,
  });
  const origin = globalThis.location?.origin || '';
  // The footer's line: what the check on this link's own content says, before Create link.
  const status = linkContentFailed ? { tone: 'bad', text: 'Couldn\'t check · this link\'s cards could not be read' }
    : !send.ready ? { tone: 'muted', text: 'Checking this link\'s content…' }
      : send.gate?.open && !send.confirmed ? { tone: 'amber', text: 'To fix · see the check above Create link' }
        : send.confirmed ? { tone: 'amber', text: 'Sharing with warnings confirmed' }
          : { tone: 'ok', text: `Passed · the content this link sends was checked${deck?.version != null ? ` on v${deck.version}` : ''}` };

  // D1570: read the gate first; anything to say opens the confirm, else the link is made.
  // D1579: the approval and the card status are read together, for the one confirm.
  const share = async () => {
    if (problem || busy || send.blocked) return;
    setBusy(true); setFailed(null);
    const readApproval = async () => {
      try { return { status: 'ok', ...(await deckCommentsApi.approval(deck.id)) }; }
      catch (e) {
        // Unread (or a reader the comments route does not admit), the link is still asked for: the Worker refuses a
        // held one, and its sentence is printed in place of the link.
        if (e?.status !== 404) reportError('ShareDialog:approval', e);
        return { status: 'error', pending: [] };
      }
    };
    const readCards = async () => {
      const a = await cardStatus(deck.id);
      if (a?.available === true) return { status: 'ok', ...a.value };
      return a?.unreadable ? { status: 'error' } : null;
    };
    const [approval, cards] = await Promise.all([readApproval(), readCards()]);
    setBusy(false);
    const g = preShareGate(approval, cards);
    if (g.show) { setGate(g); return; }
    await create();
  };

  const create = async () => {
    // Held by an approver: the Worker would refuse the link, so it is not asked for.
    if (problem || busy || gate?.held || send.blocked) return;
    setGate(null);
    setBusy(true); setFailed(null);
    try {
      // A variant's link goes through the investor-links route, which runs the same writer and sets the variant.
      const body = shareBody(state, deck);
      let r;
      if (variantUid) {
        const { deck_id: _deck, ...rest } = body;
        r = await deckInvestorLinksApi.createInvestorLink(deck.id, { ...rest, variant_uid: variantUid });
      } else {
        r = await cyclesWrite.raise.deckLink(projectId, body);
      }
      setMade(r);
      onCreated?.(r);
      // D6061: the walkthrough is attached to the link it was chosen for, once that link exists.
      const linkId = Number(r?.link?.id ?? r?.id);
      if (attaching && Number.isSafeInteger(linkId) && linkId > 0) {
        try {
          await deckRecordingsApi.attach(deck.id, linkId, true);
          setWalkDone({ ok: true, text: WALK_ATTACHED });
        } catch (e) {
          reportError('ShareDialog:walkthrough', e);
          const why = userFacingRaiseError(e, { fallback: WALK_NOT_ATTACHED, scope: 'raise:pitch:walkthrough-attach' });
          setWalkDone({ ok: false, text: why === WALK_NOT_ATTACHED ? why : `${WALK_NOT_ATTACHED} ${why}` });
        }
      }
    } catch (e) {
      reportError('ShareDialog:create', e);
      setFailed(shareFailure(e));
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <Lightbox
      label="Share"
      title={SHARE_TITLE}
      sub={made ? null : 'One investor at a time: their own link, their own watermark, their own analytics.'}
      width={made ? 560 : 1180}
      onClose={() => !busy && onClose()}
      testId="pitch-share-dialog"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!made && !gate ? (
            <span role="status" className={`mr-auto min-w-0 text-[12px] font-semibold ${status.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : status.tone === 'bad' ? 'text-axal-destructive dark:text-red-300' : status.tone === 'amber' ? 'text-amber-800 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`}
              data-testid="pitch-share-status">{status.text}</span>
          ) : null}
          <button type="button" className={GHOST} onClick={gate ? () => setGate(null) : onClose} disabled={busy}>{made ? 'Done' : gate ? 'Back' : 'Cancel'}</button>
          {!made && gate ? (
            <button type="button" className={PRIMARY} onClick={create} disabled={busy || gate.held || send.blocked}
              title={gate.held ? 'Share opens once every approver has approved this version.' : send.blocked ? 'The check on this link\'s own content is not yet clean or confirmed.' : undefined}
              data-testid="pitch-share-anyway">
              {busy ? 'Creating…' : 'Share'}
            </button>
          ) : null}
          {!made && !gate ? (
            <button type="button" className={PRIMARY} onClick={share} disabled={busy || Boolean(problem) || send.blocked} data-testid="pitch-share-create">
              {busy ? 'Creating…' : who ? `${SHARE_CTA} for ${who}` : SHARE_CTA}
            </button>
          ) : null}
        </div>
      )}
    >
      <div className="p-5 max-sm:p-4">
      {/* D4598 (#4598) part 2: off-screen, like the editor's own check (`PreflightPanel.jsx`). */}
      {send.pf.running ? (
        <PreflightMeasure key={send.pf.running.done} card={send.pf.running.snapshot.slides[send.pf.running.done]} index={send.pf.running.done}
          theme={send.pf.running.snapshot.theme} kit={kit} onMeasured={send.pf.onMeasured} />
      ) : null}
      {/*
        D1565 (#3812, pd35): this version's links, one row per investor. D6061 (PS-07): behind "Investor links (n)",
        so the page is about one investor; the table reads once and hands its answer up (`onLinks`).
      */}
      <div className="mb-4 flex flex-col gap-2" data-testid="pitch-share-links">
        <button type="button" className={`${GHOST} self-start`} aria-expanded={linksOpen} aria-controls="pitch-share-links-table"
          onClick={() => setLinksOpen((o) => !o)} data-testid="pitch-share-links-toggle">
          {linksButton(linkRows ? linkRows.length : null)} <span aria-hidden="true">{linksOpen ? '▴' : '▾'}</span>
        </button>
        <div id="pitch-share-links-table" hidden={!linksOpen}>
          <InvestorLinksTable deck={deck} projectId={projectId} refreshKey={made ? 1 : 0} onLinks={setLinks} />
        </div>
      </div>
      {gate && !made ? (
        <div className="mb-3 flex flex-col gap-2" role="alertdialog" aria-label="Before you share" data-testid="pitch-share-gate">
          {gate.lines.map((l) => (
            <div key={l.key} className={l.tone === 'amber'
              ? 'rounded-[10px] bg-amber-50 px-3 py-2.5 text-[12.5px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
              : `rounded-[10px] bg-axal-ground px-3 py-2.5 ${MUTED} dark:bg-gray-800`} data-testid={`pitch-share-gate-${l.key}`}>
              {l.text}
              {/* D1579 (pd34): the cards not Done, each with its place and status, and the way back to them. */}
              {Array.isArray(l.cards) && l.cards.length ? (
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0 font-normal" data-testid="pitch-share-gate-cards">
                  {l.cards.map((c) => (
                    <li key={c.uid} className="flex items-baseline gap-2 text-[12px]">
                      <span className="font-mono text-[10.5px]">{String(Number(c.index) + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="font-mono text-[10.5px]">{statusLabel(c.status) ?? ''}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {Array.isArray(l.cards) && l.cards.length && onReviewCards ? (
                <button type="button" className={`${GHOST} mt-2`} onClick={() => onReviewCards(l.cards[0].uid)} disabled={busy} data-testid="pitch-share-review-cards">Review cards</button>
              ) : null}
            </div>
          ))}
          {gate.held ? <p className={`m-0 ${MUTED}`}>Share opens once every approver has approved this version. They approve from Comments on any card.</p> : null}
        </div>
      ) : null}
      {made ? (
        <div className="flex flex-col gap-3" data-testid="pitch-share-made">
          {url ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[8px] bg-axal-ground px-2.5 py-2 font-mono text-[12px] dark:bg-gray-800" data-testid="pitch-share-url">{url}</code>
              <button type="button" className={GHOST} onClick={copy} data-testid="pitch-share-copy">{copied ? 'Copied' : 'Copy'}</button>
            </div>
          ) : <p className={`m-0 ${MUTED}`}>The link was made, but its address was not returned. Withdraw it from Share &amp; analytics and make another.</p>}
          <p className={`m-0 ${MUTED}`}>{SHOWN_ONCE}</p>
          {walkDone ? (
            <p role={walkDone.ok ? 'status' : 'alert'} className={`m-0 text-[12.5px] font-semibold ${walkDone.ok ? INK : 'text-axal-destructive dark:text-red-300'}`} data-testid="pitch-share-walkthrough-result">{walkDone.text}</p>
          ) : null}
          {/* D1564 (#3811): publishing this link as a web page lives here only, never in the header. */}
          <PublishPanel deck={deck} made={made} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Part title="1 · Investor" testId="pitch-share-part-investor">
            <div className="flex flex-col gap-1.5">
              <label className={EYE} htmlFor="pitch-share-investor">Investor</label>
              <select id="pitch-share-investor" className={FIELD} value={state.investor} onChange={(e) => set({ investor: e.target.value })} data-testid="pitch-share-investor">
                {prospects.rows.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                <option value={TYPED}>or type a name</option>
              </select>
              {state.investor === TYPED ? (
                <input className={FIELD} value={state.label} onChange={(e) => set({ label: e.target.value })} placeholder="The investor's name" aria-label="The investor's name" maxLength={200} data-testid="pitch-share-label" />
              ) : null}
              {prospects.status === 'error' ? <span className={MUTED}>Your prospects could not be read. Type a name instead.</span> : null}
              {state.investor && state.investor !== TYPED ? <span className={MUTED}>From your prospects in Capital relationships.</span> : null}
              {/* D1565: the recipient watermark the link will carry on every card. */}
              {investorName ? <span className={MUTED} data-testid="pitch-share-watermark">Watermark: Prepared for {investorName}</span> : null}
            </div>
            <p className={`m-0 ${MUTED}`}>{ONE_LINK_EACH}</p>
            {/* D6061: this investor's own links on this version, with their state: live until a day, withdrawn, expired. */}
            {linkRows && theirs.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 rounded-[10px] bg-axal-ground p-2.5 dark:bg-gray-800" data-testid="pitch-share-theirs">
                {theirs.map((r) => (
                  <li key={r.id} className={`flex flex-wrap items-baseline gap-x-2 text-[12px] ${INK}`} data-testid={`pitch-share-theirs-${r.id}`}>
                    <b className="font-mono">{versionWords(r, deck)}</b>
                    <span>{linkStatusLine(r)}</span>
                    <span className="text-axal-muted dark:text-gray-400">{viewsWords(r.analytics)}</span>
                  </li>
                ))}
                <li><button type="button" className="text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300" onClick={() => setLinksOpen(true)} data-testid="pitch-share-theirs-manage">Withdraw or review in Investor links</button></li>
              </ul>
            ) : null}
          </Part>
          <Part title="2 · What they get" testId="pitch-share-part-content">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <label className={EYE} htmlFor="pitch-share-target">Version or variant</label>
                <select id="pitch-share-target" className={FIELD} value={targets.some((t) => t.value === state.target) ? state.target : THIS_VERSION}
                  onChange={(e) => set({ target: e.target.value })} data-testid="pitch-share-target">
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <span className={SUB}>{FROZEN_NOTE}</span>
                {variants.status === 'error' ? <span className={MUTED} data-testid="pitch-share-variants-unread">{VARIANTS_UNREAD}</span> : null}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className={EYE}>Included content</span>
                <span className={`flex min-h-[34px] items-center rounded-[8px] border border-axal-hairline px-2 text-[12.5px] dark:border-gray-700 ${INK}`} data-testid="pitch-share-included">{includedLine(linkContent, state.include, linkContentFailed)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className={EYE}>What is included</span>
              {INCLUDE_ROWS.map((row) => (
                <Toggle key={row.key} label={row.label} on={Boolean(state.include[row.key])}
                  onChange={(v) => set({ include: { ...state.include, [row.key]: v } })} testId={`pitch-share-include-${row.key}`} />
              ))}
              <div className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
                <span className="font-semibold">Data</span>
                <span className="font-mono text-[11.5px] text-axal-violet dark:text-violet-300" data-testid="pitch-share-frozen">{frozenLine(deck)}</span>
              </div>
              <span className={MUTED}>{NEVER_SHARED}</span>
            </div>
            {/* D6061: the walkthrough as HQ's switch and the takes say it is, never "Coming later" by default. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="pitch-share-walkthrough" data-kind={walkOption.kind}>
              <span className={`min-w-0 text-[12.5px] ${INK}`}>
                <span className="font-semibold">Walkthrough recording</span>
                <span className={SUB}>{walkOption.line}</span>
              </span>
              {walkOption.kind === 'ready' ? (
                <input type="checkbox" checked={attachWalk} onChange={(e) => setAttachWalk(e.target.checked)} aria-label="Attach the walkthrough to this link" data-testid="pitch-share-walkthrough-attach" />
              ) : walkOption.kind === 'unreadable' ? (
                <button type="button" className={GHOST} onClick={loadWalk} data-testid="pitch-share-walkthrough-retry">Try again</button>
              ) : walkOption.kind === 'none' && projectId != null && deck?.id ? (
                <a href={recordHref(projectId, deck.id)} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-share-walkthrough-record">Record ›</a>
              ) : null}
            </div>
          </Part>
          <Part title="3 · Access" testId="pitch-share-part-access">
            <Toggle label={NDA_SWITCH} sub={NDA_LINE} on={state.ndaRequired} onChange={(v) => set({ ndaRequired: v })} testId="pitch-share-nda" />
            <div className="flex flex-col gap-1.5">
              <span className={EYE}>Expires</span>
              <div className="grid grid-cols-4 gap-1 rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800" role="radiogroup" aria-label="Expires">
                {EXPIRIES.map((x) => {
                  const on = x.id === state.expires;
                  return (
                    <button key={String(x.id)} type="button" role="radio" aria-checked={on} onClick={() => set({ expires: x.id })}
                      className={`min-h-[36px] rounded-[7px] px-2 py-1.5 text-[12px] font-bold ${on ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900' : 'text-axal-muted dark:text-gray-400'}`}
                      data-testid={`pitch-share-expires-${x.id ?? 'never'}`}>{x.label}</button>
                  );
                })}
              </div>
              <span className={SUB}>The link stops opening after this day. You can withdraw it sooner from Investor links.</span>
            </div>
            <Toggle label="Download" sub={DOWNLOAD_LINE} on={state.allowDownload} onChange={(v) => set({ allowDownload: v })} testId="pitch-share-download" />
            <Toggle label="Forwarding" sub={state.allowForwarding ? 'On: anyone with the address can open it.' : FORWARDING_LINE} on={state.allowForwarding} onChange={(v) => set({ allowForwarding: v })} testId="pitch-share-forwarding" />
            {/* #4272 (ps7n): the watermark row, on and fixed: every link names its investor (D1565). */}
            <label className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`} title={WATERMARK_LINE}>
              <span className="min-w-0"><span className="font-semibold">Watermark on every card</span><span id="pitch-share-watermark-line" className={SUB}>{WATERMARK_LINE}</span></span>
              <input type="checkbox" checked readOnly disabled aria-describedby="pitch-share-watermark-line" data-testid="pitch-share-watermark-toggle" />
            </label>
            <Toggle label={TIME_PER_SLIDE} sub={TIME_LINE} on={state.timePerSlide !== false} onChange={(v) => set({ timePerSlide: v })} testId="pitch-share-time-per-slide" />
            {state.timePerSlide === false ? <span className={MUTED} data-testid="pitch-share-time-off">{OFF_KEEPS}</span> : null}
            <label className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
              <span className="min-w-0"><span className="font-semibold">View limit</span><span className={SUB}>Empty for no limit, or 1 to 100 opens.</span></span>
              <input className={`${FIELD} w-28 text-right font-mono`} inputMode="numeric" value={state.viewLimit} placeholder={NO_LIMIT}
                onChange={(e) => set({ viewLimit: e.target.value })} data-testid="pitch-share-limit" />
            </label>
          </Part>
          {/*
            D4598 (#4598) part 2: this link's own effective content — the variant and "What is
            included" picked above — is checked fresh for each combination; Create link stays
            disabled (above) until it is clean or confirmed below.
          */}
          {linkContentFailed ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" role="alert" data-testid="pitch-share-content-failed">
              <span className="text-[12.5px] font-semibold text-axal-destructive dark:text-red-300">This link's content could not be read, so it could not be checked.</span>
              <button type="button" className={GHOST} onClick={() => setContentTry((t) => t + 1)} data-testid="pitch-share-content-retry">Try again</button>
            </div>
          ) : !send.ready ? (
            <span role="status" className={MUTED} data-testid="pitch-share-checking">
              {send.pf.running ? `Checking this link's content · slide ${Math.min(send.pf.progress.done + 1, send.pf.progress.total)} of ${send.pf.progress.total}` : 'Checking this link\'s content…'}
            </span>
          ) : send.gate?.open ? (
            <div className="flex flex-col gap-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" role="alertdialog" aria-label="Before you share" data-testid="pitch-share-gate-check">
              <GateBody gate={send.gate} prefix="pitch-share-gate-check" />
              {send.gate.anyway && !send.confirmed ? (
                <button type="button" className={`${GHOST} self-start`} onClick={sendAnyway} data-testid="pitch-share-gate-check-anyway">{send.gate.anyway}</button>
              ) : null}
              {send.confirmed ? (
                <span role="status" className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300" data-testid="pitch-share-confirmed">Sharing with the warnings above confirmed.</span>
              ) : null}
            </div>
          ) : null}
          <p className={`m-0 ${MUTED}`} data-testid="pitch-share-what">{problem || whatShareDoes(state, deck, investorName, variantName)}</p>
          {failed ? (
            <div role="alert" className="rounded-[10px] bg-red-50 px-3 py-2.5 text-[12.5px] font-semibold text-axal-destructive dark:bg-red-950/40 dark:text-red-300" data-testid="pitch-share-failed">{failed}</div>
          ) : null}
        </div>
        <RecipientPreview preview={preview} content={linkContent} failed={linkContentFailed} origin={origin} />
        </div>
      )}
      </div>
    </Lightbox>
  );
}

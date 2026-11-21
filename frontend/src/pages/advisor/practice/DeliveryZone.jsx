import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import { EmailAction } from '../../email/emailParts';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { advisorDeliverableFilesApi } from '../../../lib/api/advisorDeliverableFiles';
import {
  Field, NothingYet, Pill, SaveNote, StatedLimit, Unreadable, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass, zoneError,
} from '../expertise/kit';
import {
  VERSION_STATUS_LABEL, VERSION_STATUS_TONE, cardReceiptLine,
  cardStatus, fileRefusal, isReadyItem, medianLabel, nudgeTargets, readyLine, readyRefusal, reviewCoverage, seamLine,
  sentLine, statusCounts, versionTag,
} from './deliveryTrail';
import { formatDateTime } from '../advisory/kit';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import DeliverablesByClient, { DeliverableEditor } from './DeliverablesByClient';
import { AddVersionDialog, DeliverableSheet, SendConfirmDialog } from './DeliverableSheet';
import { FileChoice } from './VersionFile';
import { partialLine, readEveryPage } from './everyPage';
import ClientSheet from './ClientSheet';

/**
 * The addresses a `?view=` may open the page on: a chip of the Practice v2
 * row (#4833, D4833), or `by_client`, which D571's `/practice/deliverables`
 * redirects to and which groups the cards by client. PR3's `unopened` is
 * still read, as the Sent chip it became.
 */
const VIEWS = new Set(['all', 'draft', 'ready', 'sent', 'opened', 'accepted', 'by_client', 'unopened']);

/**
 * Practice · Delivery, `/practice/delivery`: the Practice v2 canvas's Delivery
 * zone (`design/incoming/Practice v2 Page.dc.html`, PX-06; #4833, D4833), built
 * over PR3's collection (D571, D4684, D4712).
 *
 * ARTIFACT FIRST. The unit is a work-product CARD whose state is its latest
 * version's (Draft · Ready · Sent · Opened · Accepted, from that version's own
 * stamps).
 * `Open` brings up the detail sheet: the latest version, then the immutable
 * history with each version's own recipient and receipts. Add version is a
 * dialog that needs a change note and a document, a file or a link (#5961,
 * D4833-p3, over D5960), with an optional summary (D5959); Send is a confirmation
 * that names the recipient and the document before anything goes. Ready
 * (#4833 part 2, D4833-p2, over #5316's mark, D5316) is the advisor's own note
 * that the latest unsent version is ready to send: marking it sends nothing,
 * and the send clears it.
 *
 * THE POST-SESSION REVIEW LOOP STANDS ALONE, below and outside `ZoneBody`, with
 * its own loading, error and empty state, so it is reachable with no work
 * product at all (D4712). It arrived here when `/office-hours` retired, as the
 * one capability that lived nowhere else.
 *
 * THE OPEN RECEIPT IS NOT THIS PAGE'S TO WRITE. Opened and accepted are the
 * client's (migration 208's rule, inherited by 239; D72, D4684), so no control
 * here marks anything opened or accepted.
 *
 * NO AI BAND. Nothing in this product records that an advisory session was
 * recorded, captures consent to record one, or holds a transcript of one, so
 * the zone states the gap instead of drawing a summariser over none of them.
 *
 * IN THE PRACTICE V2 SHELL (#4833 part 4, D4833-p4). The page is a body under
 * `AdvisorBucketRoutes`' Practice shell (D4829, D4834): the shell draws PX-06's
 * header, "Delivery" with its own line, and the header's one primary, New work
 * product, is this page's `newWorkProduct` handler portalled up from the
 * toolbar. The toolbar sits above `ZoneBody`, so the primary is there while
 * the list loads, is empty or failed. The body follows PX-06 A's order: chips,
 * the Ready line, the cards, then Post-session reviews; the receipt tiles and
 * what Delivery cannot say come after, the second behind a disclosure.
 */

/** The New work product form, empty. `file` is v1's document when it is a file (#5961). */
const EMPTY_DRAFT = { title: '', client_name: '', engagement_id: '', summary: '', link_url: '', version_summary: '', file: null };

export default function DeliveryZone() {
  // 'all' by default: a narrowed default would open the page mid-filter. A
  // `?view=` naming a chip opens on that chip; `by_client` groups (D571).
  const [searchParams] = useSearchParams();
  const initialView = VIEWS.has(searchParams.get('view')) ? searchParams.get('view') : 'all';
  const [filter, setFilter] = useState(() => (initialView === 'by_client' ? 'all' : initialView === 'unopened' ? 'sent' : initialView));
  const [grouped, setGrouped] = useState(initialView === 'by_client');
  const [state, setState] = useState({ loading: true, error: '', items: [], totals: null });
  // #4712 (D4712): the post-session review section has its OWN loading, error
  // and empty state. It used to ride the deliverables read and live inside the
  // children `ZoneBody` never draws for an empty collection, so an advisor with
  // completed sessions and no work product yet could not reach their reviews.
  // #4702: `coverage` is the database aggregate over EVERY held session when
  // that read answers; `coverageFailed` is unknown, never "no review".
  const [held, setHeld] = useState({
    loading: true, unavailable: false, sessions: [], heldTotal: null, reviews: {},
    coverage: null, coverageFailed: false,
  });
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [nudging, setNudging] = useState(false);
  const [engagements, setEngagements] = useState([]);
  // #4833: one work product open in the detail sheet; one Add version dialog;
  // one send confirmation. Editing a work product's details happens in its sheet,
  // or in the by-client group.
  const [openId, setOpenId] = useState(null);
  const [revising, setRevising] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [editing, setEditing] = useState(null);
  const [attaching, setAttaching] = useState(null);
  // D4833-p4: a card's client opens the shared Client Sheet (D4831) on its Delivery tab.
  const [client, setClient] = useState(null);

  const loadHeld = useCallback(async () => {
    setHeld((c) => ({ ...c, loading: true }));
    const res = await readEveryPage((page) => api.listMyAdvisorBookings('completed', page)).catch(() => null);
    if (res === null) {
      setHeld({
        loading: false, unavailable: true, sessions: [], heldTotal: null, reviews: {},
        coverage: null, coverageFailed: false,
      });
      return;
    }
    const sessions = res?.items || [];
    const heldTotal = Number.isFinite(Number(res.total)) ? Number(res.total) : sessions.length;
    // The coverage aggregate and each session's reviews are read together, and
    // neither is awaited before the work-product list (#4702). A review read
    // that fails is `null` (unknown), never `[]` ("No review") (#4712).
    const [coverageRes, ...read] = await Promise.all([
      api.getMyAdvisorReviewCoverage().catch(() => null),
      ...sessions.map(async (b) => {
        const r = await api.listBookingReviews(b.id).catch(() => null);
        return [b.id, Array.isArray(r?.items) ? r.items : null];
      }),
    ]);
    const coverage = coverageRes && Number.isFinite(Number(coverageRes.held)) && Array.isArray(coverageRes.items)
      ? coverageRes : null;
    setHeld({
      loading: false, unavailable: false, sessions, heldTotal, reviews: Object.fromEntries(read),
      coverage, coverageFailed: coverageRes === null,
    });
  }, []);

  // #4714 (D4714): the create form's engagement list is its own read. A
  // failed read says so beside the picker rather than offering only "No
  // engagement", which reads as "you have none".
  const [engagementsRead, setEngagementsRead] = useState(true);
  const [partial, setPartial] = useState(null);
  const loadEngagements = useCallback(async () => {
    try {
      const engs = await readEveryPage((page) => api.listMyAdvisorEngagements(page));
      setEngagements(engs?.items || []); setEngagementsRead(true);
    } catch { setEngagements([]); setEngagementsRead(false); }
  }, []);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      // #4714 (D4714): every page; `totals` are the whole set's.
      const read = await readEveryPage((page) => api.listMyAdvisorDeliverables(page));
      const data = { items: read.items, totals: read.first?.totals || null };
      setPartial(partialLine(read));
      // THE PRIMARY LIST RENDERS AS SOON AS IT ARRIVES. Engagements, held
      // sessions and review coverage are secondary and must not hold this list
      // on a skeleton (#4702). Engagements only feed the create form.
      setState({ loading: false, error: '', items: data?.items || [], totals: data?.totals || null });
    } catch (error) {
      setState({
        loading: false,
        error: zoneError(error, error?.message || 'The delivery record could not be read.', 'practice'),
        items: [], totals: null,
      });
      return;
    }
    loadEngagements();
  }, [loadEngagements]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadHeld(); }, [loadHeld]);

  const { items } = state;
  const totals = state.totals || {};
  // One `Date.now()` per render, so every card on one paint measures its wait
  // against the same instant.
  const now = Date.now();
  const counts = useMemo(() => statusCounts(items, state.totals), [items, state.totals]);

  /**
   * The chip row narrows in the page, on the LATEST version's own status
   * (`cardStatus`), because `profile_zone_filters.test.mjs` requires the page
   * that mounts a live chip to name its key. `all` shows every card. `ready`
   * narrows on the Worker's `ready_version` (`isReadyItem`), the set its
   * `totals.ready` count is taken over (D4833-p2).
   */
  const visible = useMemo(() => {
    const rows = [...items];
    if (filter === 'draft') return rows.filter((i) => cardStatus(i) === 'draft');
    if (filter === 'ready') return rows.filter((i) => isReadyItem(i));
    if (filter === 'sent') return rows.filter((i) => cardStatus(i) === 'sent');
    if (filter === 'opened') return rows.filter((i) => cardStatus(i) === 'opened');
    if (filter === 'accepted') return rows.filter((i) => cardStatus(i) === 'accepted');
    return rows;
  }, [items, filter]);
  // Grouping by client reorders rather than narrows (D571).
  const byClient = useMemo(() => [...visible].sort((a, b) => String(a.client_name || '').localeCompare(String(b.client_name || ''))
    || String(a.title || '').localeCompare(String(b.title || ''))), [visible]);
  const targets = useMemo(() => nudgeTargets(items), [items]);
  const openItem = openId == null ? null : items.find((i) => i.id === openId) || null;
  const engagementName = (item) => {
    if (!item?.engagement_id) return null;
    const e = engagements.find((x) => x.id === item.engagement_id);
    return e ? (e.title || e.client_name || null) : null;
  };

  // `success`, where given, is said once the write lands (D571: a write shows
  // what it did, not only what it refused).
  const act = async (key, fn, failure, success) => {
    setBusy(key); setNote(null);
    try {
      await fn();
      if (success) setNote({ ok: true, text: success });
      await load();
    }
    catch (error) { setNote({ ok: false, text: error?.message || failure }); }
    finally { setBusy(''); }
  };

  /**
   * D571 — an edit, an attach, a new version or a send answers in two places.
   * A refusal is handed back to the form or dialog that caused it, which stays
   * open; a success closes it, reloads, and is said above the cards.
   */
  const write = async (key, fn, success, failure) => {
    setBusy(key); setNote(null);
    try {
      await fn();
      setEditing(null); setAttaching(null); setRevising(null); setConfirming(null);
      setNote({ ok: true, text: success });
      await load();
      return null;
    } catch (error) {
      return error?.message || failure;
    } finally { setBusy(''); }
  };

  const saveEdit = (item, body) => write(`e-${item.id}`,
    () => api.updateMyAdvisorDeliverable(item.id, body),
    `Saved “${body.title}”.`, 'That work product could not be saved. Nothing was changed.');

  // #5961: a version whose document is a file goes as a form (D5960); a link, as JSON. A file the Worker
  // refuses comes back as its sentence in the dialog, and nothing is saved.
  const attachLink = (item, body, file = null) => write(`a-${item.id}`,
    () => (file
      ? advisorDeliverableFilesApi.addVersionWithFile(item.id, body, file)
      : api.addMyAdvisorDeliverableVersion(item.id, body)),
    `Saved v${Number(item.latest_version?.version || item.version_count || 0) + 1} of “${item.title}” as a draft, not sent.`,
    'That version could not be saved. Nothing was recorded.');

  // #5961: v1 may carry an optional summary (D5959) and a file instead of a link (D5960), never both.
  const create = () => act('new', async () => {
    const body = {
      title: draft.title.trim(),
      client_name: draft.client_name.trim() || null,
      engagement_id: draft.engagement_id || null,
      summary: draft.summary.trim() || null,
    };
    const versionSummary = draft.version_summary.trim();
    if (versionSummary) body.version_summary = versionSummary;
    if (draft.file) {
      if (draft.link_url.trim()) throw new Error('A version’s document is a link or a file, not both. Remove one.');
      const refused = fileRefusal(draft.file);
      if (refused) throw new Error(refused);
      await advisorDeliverableFilesApi.createWithFile(body, draft.file);
    } else {
      await api.createMyAdvisorDeliverable({ ...body, link_url: draft.link_url.trim() || null });
    }
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  }, 'That work product could not be created.');

  // #4833: Send always goes through the confirmation; this is what it calls.
  const send = (item) => write(`s-${item.id}`,
    () => api.sendMyAdvisorDeliverableVersion(item.id, item.latest_version.version),
    `Sent ${versionTag(item.latest_version)} of “${item.title}”.`,
    'That version could not be sent. Nothing was sent.');
  const askToSend = (item) => { setConfirming(item.id); setNote(null); };

  /**
   * #4833 part 2 (D4833-p2): mark the latest unsent version ready, or clear the
   * mark. Neither sends anything. The answer goes back to the sheet that asked,
   * which shows it beside the control; the list is read again either way, so
   * a version sent in the meantime (409 `already_sent`) shows as sent.
   */
  const toggleReady = async (item, action) => {
    const key = `r-${item.id}`;
    setBusy(key); setNote(null);
    try {
      if (action.kind === 'clear') await api.clearMyAdvisorDeliverableVersionReady(item.id, action.version);
      else await api.markMyAdvisorDeliverableVersionReady(item.id, action.version);
      await load();
      return {
        ok: true,
        text: action.kind === 'clear'
          ? `${action.tag} of “${item.title}” is a draft again. Nothing was sent.`
          : `${action.tag} of “${item.title}” is marked ready to send. Nothing was sent.`,
      };
    } catch (error) {
      if (error?.code === 'already_sent' || error?.status === 409) await load();
      return { ok: false, text: readyRefusal(error, action.tag) };
    } finally { setBusy(''); }
  };
  const confirmItem = confirming == null ? null : items.find((i) => i.id === confirming) || null;
  const reviseItem = revising == null ? null : items.find((i) => i.id === revising) || null;

  // D1345: choose a client, then review and send their draft in Email.
  // D4833-p4: `newWorkProduct` is PX-06's header primary. It waits for the list:
  // the form's engagement picker is read after it, and a failed read is said
  // below rather than offered as "no engagement".
  const listRead = !state.loading && !state.error;
  const bulkHandlers = {
    newWorkProduct: {
      onClick: () => { setAdding(true); setNote(null); },
      disabled: !listRead,
      title: state.loading ? 'Your work products are still being read.' : state.error ? 'Your work products could not be read. Try again below.' : undefined,
    },
    nudgeUnopened: {
      onClick: () => { setNudging(true); setNote(null); },
      disabled: targets.reachable.length === 0,
    },
  };

  // #4702: when the coverage route answered, the tiles are its database counts
  // over EVERY held session. A failed read stays unknown. Otherwise the tiles
  // are this page's own sessions and their review reads (#4712).
  const cov = held.coverage;
  const covById = new Map((cov?.items || []).map((i) => [i.booking_id, i]));
  const localCoverage = reviewCoverage(held.sessions, held.reviews);
  const localRatings = Object.values(held.reviews).filter(Array.isArray).flat().map((r) => Number(r.rating)).filter(Boolean);
  const ratingCount = cov ? (cov.ratings?.count ?? 0) : localRatings.length;
  const avg = cov
    ? (ratingCount > 0 ? Number(cov.ratings.sum) / ratingCount : null)
    : (localRatings.length ? localRatings.reduce((a, b) => a + b, 0) / localRatings.length : null);
  const heldCount = cov?.held ?? held.heldTotal ?? held.sessions.length;

  const createForm = (
          <div className="mb-3 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="work-product-create">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <input className={inputClass} value={draft.title} placeholder="Q2 advisory review"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="Engagement" hint="A work product under a contract takes its client from it. Sending requires one whose client has an Axal account — nothing an unlinked client is sent can ever be recorded as opened.">
                <select className={inputClass} value={draft.engagement_id}
                  onChange={(e) => setDraft({ ...draft, engagement_id: e.target.value })}>
                  <option value="">No engagement — type a client below</option>
                  {engagements.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.client_name}{e.founder_user_id ? '' : ' (no account — cannot be sent)'}
                    </option>
                  ))}
                </select>
                {!engagementsRead && (
                  <div className="mt-1" role="alert" data-testid="delivery-engagements-unreadable">
                    <Unreadable onRetry={loadEngagements}>Your engagements could not be read, so none is offered here.</Unreadable>
                  </div>
                )}
              </Field>
              {!draft.engagement_id && (
                <Field label="Client" hint="Used when there is no engagement to take the name from.">
                  <input className={inputClass} value={draft.client_name} placeholder="Halverton"
                    onChange={(e) => setDraft({ ...draft, client_name: e.target.value })} />
                </Field>
              )}
              <Field label="What changed" hint="The line the version history shows against v1.">
                <input className={inputClass} value={draft.summary} placeholder="First pass from the Aug 5 teardown"
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
              </Field>
              <Field label="Link">
                <input className={inputClass} value={draft.link_url} placeholder="https://…" disabled={!!draft.file}
                  data-testid="new-work-product-link"
                  onChange={(e) => setDraft({ ...draft, link_url: e.target.value })} />
              </Field>
              <div className="grid gap-1" role="group" aria-labelledby="new-work-product-file-label">
                <span id="new-work-product-file-label" className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint dark:text-gray-400">
                  Or a file
                </span>
                <FileChoice file={draft.file} testid="new-work-product-file" buttonClass={ghostButtonClass}
                  onChoose={(f) => setDraft((d) => ({ ...d, file: f }))} />
              </div>
              <Field label="Summary · optional" hint="What v1 says, for the client. Leave it empty if the note says enough.">
                <textarea rows={2} className={inputClass} value={draft.version_summary} data-testid="new-work-product-summary"
                  onChange={(e) => setDraft({ ...draft, version_summary: e.target.value })} />
              </Field>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
              It opens at <strong>v1, not sent</strong>. Sending is its own step, because that is the
              moment the client can start reading it. Its document is a link or a file, not both. A v1
              with neither is a draft that cannot be sent until a version carries the document.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={buttonClass}
                disabled={busy === 'new' || !draft.title.trim() || (!draft.engagement_id && !draft.client_name.trim())}
                onClick={create} data-testid="new-work-product-save">
                Add as v1
              </button>
              <button type="button" className={ghostButtonClass} onClick={() => setAdding(false)}
                data-testid="new-work-product-cancel">
                Cancel
              </button>
            </div>
          </div>
  );

  // D4833-p4: the chips count the list, so they are drawn only over a list that was read and holds a card.
  const chips = listRead && items.length > 0;
  return (
    <>
    {/* PX-06 A: the chip row and the header's primary, above every state of the list (D4833-p4). */}
    <ZoneToolbar
      className="mb-1"
      role="advisor"
      filterLabel="Filter work products"
      filters={chips ? advisorZoneFilters('practice/delivery', { value: filter, onChange: setFilter, counts }) : []}
      actions={advisorZoneActions('practice/delivery', {
        handlers: bulkHandlers,
        view: {
          header: ['Work product', 'Client', 'Version', 'Versions', 'State', 'Sent', 'Opened', 'Accepted'],
          rows: visible,
          cells: (i) => [
            i.title, i.client_name, versionTag(i.latest_version), i.version_count,
            VERSION_STATUS_LABEL[cardStatus(i)],
            i.latest_version?.sent_at, i.latest_version?.opened_at, i.latest_version?.signed_off_at,
          ],
        },
      })}
    />
    {/* D4687 (#4687): the form opens in every state of the list, the empty one included. */}
    {adding && <div className="mt-3">{createForm}</div>}
    {/* What a write did, or why it was refused, above every state of the list: a refused v1 from the empty state is said too. */}
    <SaveNote note={note} />
    <ZoneBody
      loading={state.loading}
      error={state.error}
      what="Your work products"
      isEmpty={!state.loading && !state.error && items.length === 0}
      onRetry={load}
      empty={
      <NothingYet
        title="No work product is on file"
        body="Delivery fills as you record what you send a client: each version, who it went to, and whether they opened and accepted it. It is empty because nothing has been recorded, not because anything was lost."
        action={<button type="button" className={buttonClass} onClick={() => setAdding(true)}>Record a work product</button>}
      />}
    >
      {partial && <p className="mb-2 text-[11px] text-axal-faint" data-testid="delivery-partial">{partial}</p>}

      <div className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-axal-faint dark:text-gray-400" data-testid="ready-explained">
          Ready is your own mark on a draft that is ready to send. It sends nothing; sending clears it.
        </p>
        <button type="button" className={ghostButtonClass} aria-pressed={grouped}
          onClick={() => setGrouped((g) => !g)} data-testid="group-by-client">
          {grouped ? 'Show as cards' : 'Group by client'}
        </button>
      </div>

      {nudging && (
        <Card padding="md" className="mb-3" data-testid="nudge-pr3">
          <ZoneHeading
            title="Nudge the clients who have not opened"
            blurb="Open an Email draft for each client. Review and send each one from your own mailbox."
          />
          {targets.reachable.length === 0
            ? <p className="text-[12.5px] leading-relaxed text-axal-muted">Nothing is sitting unopened, so there is nobody to nudge.</p>
            : <>
              <ul className="space-y-1.5">{targets.reachable.map((i) => (
                <li key={i.id} className="text-[12px] text-axal-muted">
                  <strong className="font-semibold text-axal-ink">{i.client_name}</strong>
                  {' · '}{i.title}{' · '}{seamLine(i, now)}
                  <span className="ml-2 inline-flex"><EmailAction person={`work_product:${i.id}`} from="Delivery" /></span>
                </li>
              ))}</ul>
              {/* THE ROWS IT WILL NOT REACH, said before anything is sent. A
                  bulk action that skips some of its set quietly is worse than
                  no button — and this is the one case the store's send rule
                  cannot prevent, an engagement unlinked after a send. */}
              {targets.missed.length > 0 && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                  {targets.missed.length} other {targets.missed.length === 1 ? 'work product is' : 'work products are'} unopened
                  and cannot be nudged: {targets.missed.map((i) => i.client_name).join(', ')} {targets.missed.length === 1 ? 'has' : 'have'} no
                  Axal account on the engagement any more, so there is no address to reach.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" className={ghostButtonClass} onClick={() => setNudging(false)}>Close</button>
              </div>
            </>}
        </Card>
      )}

      {/* PX-06 A: the cards. Grouping by client reorders the same set (D571). */}
      {visible.length === 0
        ? <p className="rounded-[10px] border border-dashed border-axal-hairline p-4 text-[12.5px] leading-relaxed text-axal-muted dark:border-gray-700 dark:text-gray-400"
          data-testid="delivery-filter-empty">
          No work product is {filter === 'all' ? 'on file' : VERSION_STATUS_LABEL[filter]?.toLowerCase() || 'in this view'} right now.
        </p>
        : grouped
          ? <Card padding="md"><DeliverablesByClient items={byClient} engagements={engagements} busy={busy}
            editing={editing} attaching={attaching} onEdit={setEditing} onAttachOpen={setAttaching}
            onSave={saveEdit} onAttach={attachLink} onSend={askToSend} /></Card>
          : <div className="grid gap-2.5" data-testid="delivery-cards">{visible.map((i) => (
            <DeliverableCard key={i.id} item={i} now={now} onOpen={() => { setOpenId(i.id); setNote(null); }}
              onOpenClient={() => setClient({ id: i.client_user_id, name: i.client_name })} />
          ))}</div>}

      {openItem && (
        <DeliverableSheet item={openItem} engagementName={engagementName(openItem)} busy={busy}
          editing={editing === openItem.id}
          onClose={() => { setOpenId(null); setEditing(null); }}
          onAddVersion={() => { setRevising(openItem.id); setNote(null); }}
          onSend={() => askToSend(openItem)}
          onToggleReady={(action) => toggleReady(openItem, action)}
          onDownloadFile={(v) => advisorDeliverableFilesApi.downloadVersionFile(openItem.id, v.version)}
          onEdit={() => setEditing(editing === openItem.id ? null : openItem.id)}>
          {editing === openItem.id && (
            <DeliverableEditor item={openItem} engagements={engagements} busy={busy === `e-${openItem.id}`}
              onCancel={() => setEditing(null)} onSave={saveEdit} />
          )}
          {/* The dialogs sit inside the sheet so they are not made inert by it. */}
          {reviseItem && reviseItem.id === openItem.id && (
            <AddVersionDialog item={reviseItem} busy={busy === `a-${reviseItem.id}`}
              onCancel={() => setRevising(null)} onSave={attachLink} />
          )}
          {confirmItem && confirmItem.id === openItem.id && (
            <SendConfirmDialog item={confirmItem} busy={busy === `s-${confirmItem.id}`}
              onCancel={() => setConfirming(null)} onConfirm={send} />
          )}
        </DeliverableSheet>
      )}
      {/* From the by-client group, with no sheet open. */}
      {!openItem && confirmItem && (
        <SendConfirmDialog item={confirmItem} busy={busy === `s-${confirmItem.id}`}
          onCancel={() => setConfirming(null)} onConfirm={send} />
      )}
    </ZoneBody>
    {/* #4712 (D4712): OUTSIDE `ZoneBody`, with its own loading, error and empty
        state. The collection above may be empty (no work product yet) while
        completed sessions are waiting for a review, and a review of a session
        is not a property of any work product. */}
    <Card padding="md" className="mt-3" data-testid="review-loop">
      <ZoneHeading
        title="Post-session reviews"
        blurb="Independent of work products: the sessions you have held, whether each has a review, and your own review of them."
      />
      {held.loading
        ? <p className="text-[12.5px] leading-relaxed text-axal-muted" aria-busy="true">Reading your held sessions…</p>
        : held.unavailable
          ? <div role="alert">
            <p className="text-[12.5px] leading-relaxed text-axal-muted">
              Your held sessions could not be read. That is not a claim that you have none.
            </p>
            <button type="button" className={`${ghostButtonClass} mt-2`} onClick={loadHeld}>Try again</button>
          </div>
          : held.sessions.length === 0
            ? <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="review-loop-empty">
              No session is marked as held yet. Once you mark one held under Sessions, you can review it here.
            </p>
            : <>
              {/* #4702: the tiles are database counts over EVERY held session when
                  the coverage read answered. A failed read says so, and never
                  turns an unread session into "without a review". */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Sessions held" value={heldCount}
                  note={heldCount ? 'marked completed' : 'none marked completed yet'} />
                <Stat label="Reviewed"
                  value={cov ? cov.reviewed : (held.coverageFailed ? <Unrecorded>Not read</Unrecorded> : localCoverage.reviewed)}
                  note={cov ? `${cov.awaiting} without a review`
                    : held.coverageFailed ? 'review coverage could not be read'
                      : `${localCoverage.awaiting} without a review${localCoverage.unknown ? ` · ${localCoverage.unknown} not read` : ''}`} />
                {/* THE EM-DASH THIS PAGE INHERITED AND DOES NOT KEEP (D56/D68). */}
                <Stat label="Average rating"
                  value={avg == null ? <Unrecorded>Not recorded</Unrecorded> : avg.toFixed(1)}
                  note={held.coverageFailed && !cov ? 'review coverage could not be read'
                    : ratingCount ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'no review has been filed'} />
              </div>
              <ul className="mt-3 space-y-2">{held.sessions.slice(0, 10).map((b) => {
                const item = cov ? covById.get(b.id) : undefined;
                const rs = held.reviews[b.id];
                // The coverage route, when it answered, is the one definition:
                // a session it did not list was not read. When that route failed,
                // every row is unread. Otherwise the session's own review read
                // decides (#4712).
                const unread = cov ? !item : (held.coverageFailed || !Array.isArray(rs));
                const mine = cov ? item?.advisor_filed === true : (unread ? null : rs.find((r) => r.reviewer_role === 'advisor'));
                const none = cov ? item?.reviews === 0 : (!unread && rs.length === 0);
                const rating = cov ? item?.rating : (unread ? null : rs[0]?.rating);
                return (
                  <li key={b.id} data-testid={`row-pr3-session-${b.id}`}
                    className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="text-[12.5px] font-extrabold tracking-tight">{b.topic || 'Session'}</strong>
                        <p className="mt-0.5 text-[11px] text-axal-faint">
                          {b.founder_name || b.founder_email || `Member #${b.founder_user_id}`}
                          {' · '}{b.slot_starts_at ? formatDateTime(b.slot_starts_at) : <Unrecorded>date not recorded</Unrecorded>}
                        </p>
                      </div>
                      {unread
                        ? <Pill tone="neutral">Reviews not read</Pill>
                        : none
                          ? <Pill tone="warn">No review</Pill>
                          : <span className="flex items-center gap-1 text-[11px] font-semibold">
                            <Star size={11} fill="currentColor" className="text-amber-400" />
                            {rating == null ? '' : Number(rating).toFixed(1)}
                            {mine ? <Pill tone="ok">Yours filed</Pill> : <Pill tone="neutral">Theirs only</Pill>}
                          </span>}
                    </div>
                    {/* THE CONTROL, NOT JUST THE COUNT. A page that says "3
                        without a review" and cannot file one is the gap it is
                        reporting. An unread session offers no form: filing over
                        reviews that were not read could duplicate one. */}
                    {!unread && !mine && <ReviewForm booking={b} onFiled={loadHeld} />}
                  </li>
                );
              })}</ul>
              {held.heldTotal != null && held.heldTotal > held.sessions.length && (
                <p className="mt-2 text-[11px] text-axal-faint" data-testid="held-truncated">
                  Showing the {Math.min(10, held.sessions.length)} newest of {held.heldTotal} held sessions. The counts above cover all {held.heldTotal}.
                </p>
              )}
            </>}
    </Card>
    {/* D4833-p4: below the reviews, as PX-06 A puts nothing between the cards and them. The receipt
        tiles are drawn over a list that was read and holds a card, as they were inside ZoneBody. */}
    {chips && (
      <section aria-label="Receipts across every work product" data-testid="delivery-receipts">
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Work products" value={totals.work_products ?? 0}
            note={totals.clients
              ? `across ${totals.clients} ${totals.clients === 1 ? 'client' : 'clients'}`
              : 'no client has a work product yet'} />
          <Stat label="Unopened" value={totals.unopened ?? 0}
            note={totals.unopened ? 'sent, not read' : 'nothing is waiting to be read'} />
          {/* A REAL MEASUREMENT: both `sent_at` and `opened_at` are stamps. Null
              before the first open, and null renders as "Not recorded", never
              "0 h" (D56/D68). */}
          <Stat
            label="Median to open"
            value={medianLabel(totals.median_to_open_hours) ?? <Unrecorded>Not recorded</Unrecorded>}
            note={totals.median_to_open_hours == null ? 'nothing has been opened yet' : 'from send to first read'} />
          <Stat label="Never opened" value={totals.never_opened ?? 0}
            note={totals.oldest_never_opened
              ? `${totals.oldest_never_opened.client_name} · ${totals.oldest_never_opened.title}`
              : 'everything sent has been read'} />
        </div>
      </section>
    )}
    <details className="mt-3 rounded-xl border border-axal-hairline p-3 dark:border-gray-700" data-testid="delivery-limits">
      <summary className="cursor-pointer text-[12px] font-semibold text-axal-muted dark:text-gray-300">
        What Delivery records, and what it cannot say
      </summary>
      <Card padding="md" variant="sunken" className="mt-3">
        <ZoneHeading
          title="Follow-ups from sessions"
          blurb="Not available for advisory sessions yet."
        />
        <p className="text-[12px] leading-relaxed text-axal-muted">
          A summary of a session needs a transcript, a transcript needs a recording, and a recording
          needs consent agreed before it is made. <strong>Axal does not record advisory sessions, so
          none of those three exists yet.</strong> Until then there is nothing to summarise, so no
          button offers to.
        </p>
      </Card>

      <StatedLimit title="What Delivery cannot say">
        <p>
          <strong>A work product can only be sent to a client with an Axal account.</strong> An
          engagement may name a company that has not joined, and a version sent to one could never be
          recorded as opened. Axal refuses the send rather than keeping a figure that quietly means nothing.
        </p>
        <p className="mt-2">
          <strong>Opened and Accepted are the client&rsquo;s to give:</strong>
          nothing on this page marks a work product opened or accepted. A receipt records when a
          version was first opened, not how long it was read.
        </p>
        <p className="mt-2">
          A version&rsquo;s document is a web link or a stored file, a PDF, JPEG or PNG of at most 10 MB. A
          version is a draft until it is sent; marking it Ready tells you, not the client, that it can
          go. There is no consent-gated session summary either; see the card above.
        </p>
      </StatedLimit>
    </details>
    {client && (
      <ClientSheet key={client?.id} clientUserId={client?.id} clientName={client?.name} initialTab="Delivery"
        onClose={() => setClient(null)} />
    )}
    </>
  );
}

/**
 * #4833 (D4833) — one work product as a card (PX-06 A): title, client, the
 * latest version and when it went, its receipts, its status, and Open.
 *
 * The status is the LATEST version's (`cardStatus`). A card whose engagement
 * has no client account says it cannot be sent, because Send would be refused.
 */
function DeliverableCard({ item, now, onOpen, onOpenClient }) {
  const latest = item.latest_version;
  const status = cardStatus(item);
  // The version the Worker says is marked ready (`ready_version`), which is the
  // latest one whenever the mark was set here; an older one says its number.
  const readyVersion = isReadyItem(item)
    ? (item.versions || []).find((v) => Number(v.version) === Number(item.ready_version)) || null
    : null;
  return (
    <article data-testid={`row-pr3-${item.id}`} data-status={status}
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-axal-hairline bg-white p-3.5 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.title}</h3>
        <p className="mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">
          {/* D4833-p4: PX-06 A links the client. Only a client with an account has a Client Sheet (D4831). */}
          {item.client_user_id != null
            ? <button type="button" onClick={onOpenClient} data-testid={`client-pr3-${item.id}`}
              className="font-semibold text-emerald-700 underline-offset-2 hover:underline max-sm:min-h-[44px] dark:text-emerald-300">
              {item.client_name || `Member #${item.client_user_id}`}
            </button>
            : item.client_name}
          {latest ? <> · Latest {versionTag(latest)} · {sentLine(latest)}</> : <> · <Unrecorded>No version recorded yet</Unrecorded></>}
        </p>
        <p className="mt-1 text-[11px] tabular-nums text-cyan-700 dark:text-cyan-300" data-testid={`receipt-pr3-${item.id}`}>
          {cardReceiptLine(item, now)}
        </p>
        {isReadyItem(item) && (
          <p className="mt-1 text-[11px] text-axal-violet-deep dark:text-violet-300" data-testid={`ready-line-pr3-${item.id}`}>
            {Number(item.ready_version) === Number(latest?.version) ? '' : `v${item.ready_version} · `}
            {readyVersion ? readyLine(readyVersion) : `v${item.ready_version} marked ready to send`}
          </p>
        )}
        {item.client_user_email == null && item.client_user_id == null && status === 'draft' && (
          <p className="mt-1 text-[10.5px] text-amber-700 dark:text-amber-300">No client account — this cannot be sent</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Pill tone={VERSION_STATUS_TONE[status]}>{VERSION_STATUS_LABEL[status]}</Pill>
        <button type="button" className={`${ghostButtonClass} max-sm:min-h-[44px] max-sm:min-w-[44px]`} onClick={onOpen}
          data-testid={`open-pr3-${item.id}`} aria-label={`Open ${item.title}`}>
          Open
        </button>
      </div>
    </article>
  );
}
function Stat({ label, value, note }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-faint">{note}</div>
    </Card>
  );
}

/**
 * The advisor's own review of a session they held — ported whole, and the port is
 * the point.
 *
 * IT CAME FROM `/office-hours` TO THE LEGACY DELIVERY TAB when that page was
 * retired, as the one capability living nowhere else, and it reached this page
 * the same way: `/advisor/advisory/delivery` is a redirect now, so the form would
 * have been unreachable the moment PR3 shipped. Carrying only the COUNT across —
 * "N without a review" over no control — would have been the page reporting the
 * gap it had just created.
 *
 * THE WORKER'S TWO REFUSALS ARE SENTENCES, NOT SWALLOWED. It rejects anything but
 * a completed booking (409) and a second review from the same side (UNIQUE on
 * `booking_id` + `reviewer_role`), and a reader who typed a comment is owed the
 * reason rather than a button that did nothing.
 */
function ReviewForm({ booking, onFiled }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.fileAdvisorReview(booking.id, { rating, comment: comment.trim() });
      setOpen(false);
      await onFiled();
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('already reviewed')) setError('You have already reviewed this session.');
      else if (msg.includes('completed')) setError('Only a session marked as held can be reviewed. Mark it held under Sessions first.');
      else setError(err?.message || 'The review could not be filed. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={`${ghostButtonClass} mt-2`} onClick={() => setOpen(true)}>
        Review this session
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint">Your review of them</div>
      <div className="mt-1.5 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => setRating(i)} aria-label={`${i} star${i === 1 ? '' : 's'}`}>
            <Star size={18} fill={i <= rating ? 'currentColor' : 'none'}
              className={i <= rating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} />
          </button>
        ))}
      </div>
      <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
        placeholder="Were they prepared? Would you take another session?"
        className={`${inputClass} mt-2`} />
      {error && <p className="mt-2 text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Filing…' : 'File review'}</button>
        <button type="button" className={ghostButtonClass} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-faint">
        Yours and theirs are separate records. Filing this does not show you theirs, and does not
        prompt them for one.
      </p>
    </form>
  );
}

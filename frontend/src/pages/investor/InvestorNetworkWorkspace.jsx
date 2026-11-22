import NetworkIntroOffer from '../relationships/NetworkIntroOffer';
import NetworkTieRequest from '../relationships/NetworkTieRequest';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { WorkerRail, Unreadable } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import './investorNetworkWorkspace.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { titleCase } from '../../lib/absence';
import { COLD_AFTER_DAYS, coldView, coldestDays, reminderDue, shortDate, touchHistory, touchRecorder, openReminderFor, reminderLists } from '../../lib/networkBook';
import { useAuth } from '../../hooks/useAuthSync';
import { introTarget, askKey, createIntroRequests, quotaFrom, askTargetName, askDate } from '../../lib/investorIntroRequest';
import InvestorIntroRequest from './InvestorIntroRequest';
import { introTargetIsMine, resolveIntroTarget } from '../../lib/introDestination';
import { counterpartAnswer, introCreditView } from './introCreditModel.js';

/**
 * A section heading's right-hand detail, in the order the body already reads
 * its state: error, then loading, then the fact.
 *
 * WHAT THIS FIXES. `null` meant both "not fetched yet" and "fetch failed" —
 * `setIntroductions` is only called on a fulfilled result — so a rejection left
 * the heading printing "Loading propositions" forever, directly above the alert
 * saying the propositions were unavailable. Both statements on screen at once,
 * one of them false. Same shape on all three sections, which is why this is one
 * helper rather than three ternaries.
 */
const detailFor = (error, value, describe) => {
  if (error) return 'Source unavailable';
  if (value === null || value === undefined) return 'Loading records';
  return describe();
};

const typeLabel = (value) => titleCase(value) || 'Relationship';
const personName = (relationship) => relationship?.other?.name || relationship?.other?.email || 'Unidentified relationship';
const age = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(String(value).replace(' ', 'T'));
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (!Number.isFinite(days)) return 'Not recorded';
  return days === 0 ? 'Today' : `${days}d ago`;
};
const safeKey = (value) => String(value || 'record').replace(/\W+/g, '-').toLowerCase();

/** #4611 finding 7: four cards is an OVERVIEW's preview, never a zone's whole list. */
const PROPOSITION_PREVIEW = 4;
/** How many more the zone reveals per press. */
const PROPOSITION_PAGE = 10;
/** The Organizations roll-up's preview and page, the same distinction. */
const ORGANIZATION_PREVIEW = 6;
const ORGANIZATION_PAGE = 12;

/**
 * #4611 finding 7 — the heading's counts, each with its scope named.
 *
 * It read `${propositionRows.length} shown` over four cards, so with thirty
 * propositions it said "30 shown" above four. Three numbers mean three
 * different things here and the heading now says which is which: how many are
 * on screen, how many the current filter matches, and how many exist. The
 * middle one is printed only when a filter is narrowing, because otherwise it
 * equals the last and repeating it would be noise.
 */
function propositionScopes({ pending, shown, filtered, total, filteredView }) {
  const parts = [`${pending} awaiting your decision`];
  parts.push(shown >= filtered ? `${shown} shown` : `${shown} of ${filtered} shown`);
  if (filteredView && filtered !== total) parts.push(`${total} recorded in all`);
  return parts.join(' · ');
}
// D6260: `GET /api/introductions` names an ask's target only where the reader
// may still see that founder or project (D702's rules); otherwise the row
// reads "Not available" (`askTargetName`, lib/investorIntroRequest.js).
// The last touch is the interaction log's MAX (migration 338), never a field
// someone edits and never a metadata fallback.
const lastTouchAt = (relationship) => relationship?.last_interaction_at || null;
const relationshipContext = (relationship) => relationship?.context
  || relationship?.deal_name
  || relationship?.fund_name
  || relationship?.project?.name
  || relationship?.metadata?.context
  || relationship?.metadata?.deal_name
  || relationship?.metadata?.fund_name
  || 'No deal or fund context recorded';
/**
 * The counterpart's own company (D572 part 3, read here since D6258): the
 * company the other person links on their account (`user_company_links`), the
 * one they are primary admin of first, else the oldest link. The Worker sends
 * it as `other.company`, a name or null, read at query time. Null is "not
 * recorded". A row carrying `companies_unreadable` is a failed read, which
 * is not the same as no company, so `companiesUnreadable` below is asked
 * before this is trusted. Nothing here reads a name or an email domain.
 */
const companyName = (relationship) => {
  const name = relationship?.other?.company;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
};
const companiesUnreadable = (rows) => Array.isArray(rows) && rows.some((row) => row?.companies_unreadable === true);
/** The Person row's company line: the name, "Not recorded", or the failed read said as one. */
const companyLine = (relationship) => (relationship?.companies_unreadable === true
  ? 'Company could not be read'
  : companyName(relationship) || 'Not recorded');
const introductionContext = (prop) => {
  const reasons = Array.isArray(prop?.breakdown?.reasons) ? prop.breakdown.reasons : [];
  const reason = reasons.map((item) => typeof item === 'string' ? item : item?.reason || item?.label || item?.detail).find(Boolean);
  return reason || prop?.breakdown?.relationship_context || 'Context is retained with the proposition and reviewed before consent.';
};

function SectionHeading({ id, title, detail, actions, role, filters }) {
  // The action row belongs to the SECTION, not to the page header — that header
  // sits behind `{!embedded && …}` and is false on every zone route, because
  // NetworkWorkspace supplies the crumb and the zone nav itself. A row placed
  // in there renders nowhere, which is exactly what happened on the founder's
  // three Network zones and took a browser to see. Per section also answers
  // `/network` itself, where all three sections show at once and no single row
  // could be right.
  return <div className="inw-section-head" id={id}><h2>{title}</h2><span data-testid={`text-${id}-detail`}>{detail}</span>
    {/* `ZoneToolbar` renders `ZoneActions` internally, so the ops half is
        unchanged; the filter half joins it on the same rule-bordered row the
        canvas draws. A section whose zone has no filter table yet passes `[]`
        and gets exactly the row it had. */}
    {filters?.length || actions?.length
      ? <ZoneToolbar className="basis-full" role={role} filters={filters || []} actions={actions || []} />
      : null}</div>;
}

function Skeleton({ rows = 4 }) {
  return <div className="inw-skeleton" data-testid="network-loading-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>;
}

function Alert({ children }) {
  return <div className="inw-alert" role="status" data-testid="status-network-error"><CircleAlert size={14} />{children}</div>;
}

// `embedded`: on /network/{relationships,introductions,organizations} the
// WorkspaceShell already draws the heading, the zone row and the rail. This
// page drew all three again, which is why an investor saw two Worker AI rails
// side by side on those routes.
//
// `zone`: which single section to render. On `/network` there is none and all
// three stack, which is the overview and is right. On a zone route it is the
// slug the shell already resolved, and passing it is what stopped all three
// zone routes rendering the identical body — the pills moved, the page did
// not, on every one of the three. Naming the sections here rather than
// splitting the page keeps one relationship source for the book and directory.
export default function InvestorNetworkWorkspace({ embedded = false, zone = null, role = 'investor', zoneFilters = null, initialActionError = '' }) {
  const { user } = useAuth() || {};
  // The relationship book's zone view. Four live chips — Everyone, Founders,
  // Co-investors and Going cold. LPs stay prose: an LP register is a fund
  // record, not a relationship row.
  const [bookView, setBookView] = useState('all');
  // The introductions desk's zone view. `Stalled` is `status = 'expired'`,
  // which the route writes lazily on every read. `Asked` is live: an
  // investor's own asks are stored in `investor_introductions` and loaded
  // beside the propositions. `Offered` is prose on the row — an introduction
  // you gave is logged as value-add support, not on this desk.
  const [deskView, setDeskView] = useState('all');
  const [params] = useSearchParams();
  // #4609: the proposition surface claims a `kind=proposition` target and any
  // target whose kind the link did not say (every notification sent before the
  // destination contract). A `kind=request` uid belongs to the teammate desk.
  const deepLink = resolveIntroTarget(params);
  const highlightedIntro = introTargetIsMine(deepLink, 'proposition') ? deepLink.uid : '';
  const requestedTab = params.get('tab') || '';
  const inOrgZone = zone === 'organizations';
  const [networkPicker, setNetworkPicker] = useState(null);
  const [networkPickerNotice,setNetworkPickerNotice]=useState('');
  const [relationships, setRelationships] = useState(null);
  const [relationshipsReading, setRelationshipsReading] = useState(false);
  const latestRelationshipRead = useRef(0);
  const [introductions, setIntroductions] = useState(null);
  const [asks, setAsks] = useState(null);
  const [askNamesUnreadable, setAskNamesUnreadable] = useState(false);
  const [introRequestStates, setIntroRequestStates] = useState({});
  const [errors, setErrors] = useState({});
  // D6260: the quota is read before an ask can be sent; `unreadable` disables sending.
  const [introQuota, setIntroQuota] = useState({ status: 'loading', value: null });
  const readAsks = useCallback(async () => {
    try {
      const value = await api.listIntroductions();
      if (!Array.isArray(value?.introductions)) throw new Error('Unrecognized ask history response');
      setAsks(value.introductions);
      setAskNamesUnreadable(value.targets_unreadable === true);
      setErrors((current) => ({ ...current, asks: '' }));
    } catch {
      setErrors((current) => ({ ...current, asks: 'Your recorded asks are unavailable right now.' }));
    }
  }, []);
  const readIntroQuota = useCallback(() => api.introductionsQuota().then(
    (value) => { const q = quotaFrom(value); setIntroQuota(q ? { status: 'ready', value: q } : { status: 'unreadable', value: null }); },
    () => setIntroQuota({ status: 'unreadable', value: null }),
  ), []);
  const requestIntro = useMemo(() => createIntroRequests(body => api.introductionsRequest(body), setIntroRequestStates, {
    // The answer carries the new count; the recorded asks are read again so the Asked view shows the new row.
    onSpent: (result) => {
      setIntroQuota((current) => { const q = quotaFrom(result, current.value); return q ? { status: 'ready', value: q } : current; });
      readAsks();
    },
    onRefused: (data) => {
      setIntroQuota((current) => { const q = quotaFrom(data, current.value); return q ? { status: 'ready', value: q } : current; });
    },
  }), [readAsks]);
  const pendingAskTargets = new Set((asks || []).filter(ask => ask.status === 'pending').map(askKey));
  const introAction = (targets) => role === 'investor' ? <InvestorIntroRequest targets={targets} states={introRequestStates} request={requestIntro} ready={asks !== null && !errors.asks} asked={pendingAskTargets} quota={introQuota} /> : null;
  // The reminders (migration 338) and which row a form is open on.
  const [reminders, setReminders] = useState(null);
  const [reminderFor, setReminderFor] = useState(null);
  const [touchFor, setTouchFor] = useState(null);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [touchNote, setTouchNote] = useState('');
  const [touchDate, setTouchDate] = useState('');
  const [privateNoteFor, setPrivateNoteFor] = useState(null);
  const [privateNoteDraft, setPrivateNoteDraft] = useState('');
  const [privateNoteBusy, setPrivateNoteBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyUid, setBusyUid] = useState('');
  const [actionError, setActionError] = useState(initialActionError);
  const creditView = introCreditView(introductions?.credits, { unreadable: Boolean(errors.introductions), loading: refreshing || (!errors.introductions && introductions === null) });
  // #6259: the touch log is read back, so it has the three states every read
  // has — null while loading, the rows, or the failure (never shown as empty).
  const [touchLog, setTouchLog] = useState(null);
  const [touchLogError, setTouchLogError] = useState('');
  // #6259: the Reminders view — upcoming and done, opened by the header op.
  const [remindersOpen, setRemindersOpen] = useState(false);

  const readRelationships = useCallback(async () => {
    const read = ++latestRelationshipRead.current;
    setRelationshipsReading(true);
    try {
      const value = await api.partnerRelationships();
      const rows = Array.isArray(value) ? value : value?.items;
      if (!Array.isArray(rows)) throw new Error('Unrecognized relationship response');
      if (read !== latestRelationshipRead.current) return;
      setRelationships(rows);
      setErrors((current) => ({ ...current, relationships: '' }));
    } catch {
      if (read !== latestRelationshipRead.current) return;
      setErrors((current) => ({ ...current, relationships: 'Relationship book is unavailable right now.' }));
    } finally {
      if (read === latestRelationshipRead.current) setRelationshipsReading(false);
    }
  }, []);

  const load = useCallback(async (refresh = false) => {
    setRefreshing(refresh);
    setActionError('');
    const relationshipRead = readRelationships();
    const askRead = readAsks();
    // Reading propositions can generate or expire records. Directory visits
    // and retries only need ties plus the separate, read-only ask state.
    if (!inOrgZone) {
      const [summaryResult, introResult, reminderResult] = await Promise.allSettled([
        api.partnerSummary(), api.introPropositions(refresh ? { refresh: true } : {}), api.partnerReminders(true),
      ]);
      if (introResult.status === 'fulfilled') setIntroductions(introResult.value || { propositions: [], credits: null });
      if (reminderResult.status === 'fulfilled') setReminders(Array.isArray(reminderResult.value?.items) ? reminderResult.value.items : []);
      setErrors((current) => ({
        ...current,
        summary: summaryResult.status === 'rejected' ? 'Network aggregate unavailable.' : '',
        introductions: introResult.status === 'rejected' ? 'Introduction propositions are unavailable right now.' : '',
        reminders: reminderResult.status === 'rejected' ? 'Your reminders are unavailable right now.' : '',
      }));
    }
    await Promise.all([relationshipRead, askRead]);
    setRefreshing(false);
  }, [inOrgZone, readRelationships, readAsks]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (role === 'investor') readIntroQuota(); }, [role, readIntroQuota]);
  useEffect(() => {
    if (remindersOpen) document.getElementById('network-reminders')?.scrollIntoView?.({ block: 'start' });
  }, [remindersOpen]);

  useEffect(() => {
    if (highlightedIntro && introductions) {
      document.getElementById(`network-intro-${safeKey(highlightedIntro)}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const section = requestedTab === 'introductions'
      ? 'introductions-desk'
      : requestedTab === 'relationships'
        ? 'relationship-book'
        : '';
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [highlightedIntro, introductions, requestedTab]);

  const propositionRows = introductions?.propositions || [];
  // THE ZONE VIEW NARROWS BEFORE THE CAP, and the order matters: the memo below
  // shows four propositions and pins a deep-linked one into them, so a filter
  // applied after it would only ever search the first four rows.
  const deskRows = deskView === 'stalled'
    ? propositionRows.filter((prop) => String(prop.status || '').toLowerCase() === 'expired')
    : propositionRows;
  /**
   * #4611 finding 7 — THE PREVIEW CAP IS AN OVERVIEW'S, AND THIS IS A ZONE.
   *
   * `deskRows.slice(0, 4)` was applied everywhere this page renders — the
   * `/network` overview, where four cards is right, AND the dedicated
   * `/network/introductions` zone, where it is the only place a member can act
   * on a proposition at all. So with thirty propositions the fifth was
   * unreachable: no page control, no "show all", nothing. Accepted and declined
   * records fell off the same edge. The heading beside the four cards read
   * "30 shown".
   *
   * `zone` is the prop `NetworkWorkspace` already passes, so the cap is now
   * exactly what its name says: a PREVIEW, on the overview only. In the zone
   * the list pages through `PROPOSITION_PAGE` rows at a time, which keeps the
   * section a readable length while every record stays reachable by ordinary
   * navigation.
   *
   * The deep-link pin stays, and it has to stay ahead of the cap: a highlighted
   * proposition is pulled into the preview rather than being cut off by it,
   * which is what makes a notification land on its record on the overview too.
   */
  const inZone = zone === 'introductions';
  const [shown, setShown] = useState(PROPOSITION_PAGE);
  // A new filter is a new list: showing page three of `all` as page three of
  // `stalled` would hand the member a short list and call it the end of a long
  // one.
  useEffect(() => { setShown(PROPOSITION_PAGE); }, [deskView, inZone]);
  const cap = inZone ? shown : PROPOSITION_PREVIEW;
  const visiblePropositions = useMemo(() => {
    const compact = deskRows.slice(0, cap);
    if (!highlightedIntro || compact.some((prop) => prop.uid === highlightedIntro)) return compact;
    const highlighted = deskRows.find((prop) => prop.uid === highlightedIntro);
    return highlighted ? [highlighted, ...compact.slice(0, Math.max(0, cap - 1))] : compact;
  }, [highlightedIntro, deskRows, cap]);
  const morePropositions = Math.max(0, deskRows.length - visiblePropositions.length);
  // #4611 finding 7: the export view below takes `deskRows` — the whole
  // filtered collection, which is what the heading's "of N" names. It used to
  // take the four cards on screen while the heading beside it said thirty, so a
  // member exported four rows believing they had thirty. Every sibling zone on
  // this page already exported its full array; propositions was the odd one.
  // The `Asked` view's rows: this investor's own asks, newest first as the
  // route returns them.
  const askRows = asks || [];
  // D6258: the companies read failed, said once for the section and the rows.
  const orgsUnreadable = companiesUnreadable(relationships);
  const [orgView, setOrgView] = useState('all');
  const organizations = useMemo(() => {
    if (!relationships || errors.relationships || orgsUnreadable) return [];
    const grouped = new Map();
    for (const item of relationships) {
      const name = companyName(item);
      const personId = Number(item.other?.id);
      if (!name || !Number.isSafeInteger(personId) || personId <= 0) continue;
      const profileId = item.other.company_profile_id;
      // A legacy response can supply a name alone. Keep it attributed to
      // that account until the server can confirm a shared linked profile.
      const key = profileId ? `profile:${profileId}` : `affiliation:${personId}`;
      const entry = grouped.get(key) || { key, name, profileId, people: new Map(), types: new Set(), introTargets: new Map(), coInvestor: false };
      const person = entry.people.get(personId) || { name: item.other.name?.trim(), role: item.other.role, lastTouch: null };
      const touch = lastTouchAt(item);
      if (touch && (!person.lastTouch || Date.parse(touch) > Date.parse(person.lastTouch))) person.lastTouch = touch;
      entry.people.set(personId, person);
      const target = introTarget(item);
      if (target && (target.body.founder_user_id ? person.name : item.project?.name?.trim())) entry.introTargets.set(target.key, target);
      if (item.relationship_type) entry.types.add(typeLabel(item.relationship_type));
      if (item.relationship_type === 'co_investor') entry.coInvestor = true;
      grouped.set(key, entry);
    }
    return [...grouped.values()].sort((a, b) => b.people.size - a.people.size || a.name.localeCompare(b.name));
  }, [relationships, errors.relationships, orgsUnreadable]);
  // #4611 finding 7, same shape one section down: six rows were drawn under a
  // heading that counted every organisation. The zone pages; the overview
  // previews and says so.
  const [orgShown, setOrgShown] = useState(ORGANIZATION_PAGE);
  useEffect(() => { setOrgShown(ORGANIZATION_PAGE); }, [inOrgZone, orgView]);
  const orgRows = orgView === 'co_investors' ? organizations.filter((org) => org.coInvestor) : organizations;
  const visibleOrganizations = orgRows.slice(0, inOrgZone ? orgShown : ORGANIZATION_PREVIEW);
  const moreOrganizations = Math.max(0, orgRows.length - visibleOrganizations.length);

  /**
   * The interaction log and the reminders (migration 338). Logging a touch
   * moves the cold flag — the book reads the log's MAX, so an honest record
   * of the last exchange is the only way the flag moves. A reminder surfaces
   * on the desk when it is due; there is no notification fan-out.
   */
  // #6259: the log is READ BACK now, not only used to draw void buttons. A
  // failed read is the panel's own "could not be read" state, never an empty
  // history — and the note it carries is personal content, so nothing here
  // logs it.
  const readTouchLog = async (id) => {
    setTouchLog(null);
    setTouchLogError('');
    try {
      const log = await api.partnerInteractionLog(id);
      setTouchLog(touchHistory(log?.items));
    } catch {
      setTouchLogError('unreadable');
    }
  };
  const openTouch = async (item) => {
    setActionError('');
    const open = touchFor === item.id ? null : item.id;
    setTouchFor(open);
    setReminderFor(null);
    setPrivateNoteFor(null);
    setTouchLog(null);
    setTouchLogError('');
    if (!open) return;
    await readTouchLog(item.id);
  };
  const voidTouch = async (rel, uid) => {
    setActionError('');
    try {
      await api.partnerInteractionVoid(rel.id, uid);
    } catch (cause) {
      setActionError(cause?.message || 'The touch could not be voided.');
      return;
    }
    await readTouchLog(rel.id);
    load();
  };
  const logTouch = async (rel) => {
    setActionError('');
    const note = touchNote.trim();
    const date = touchDate.trim();
    if (!note && !date) {
      setActionError('Say what happened or set when it happened — an empty touch must not move the cold flag.');
      return;
    }
    const body = { note: note || null };
    if (date) body.interacted_at = `${date}T12:00:00.000Z`;
    try {
      await api.partnerInteractionAdd(rel.id, body);
      // #6259: the panel stays open and its history is read again, so the
      // member sees the touch they just recorded at the top of the list.
      setTouchNote(''); setTouchDate('');
      readTouchLog(rel.id);
      load();
    } catch (cause) { setActionError(cause?.message || 'The touch could not be recorded.'); }
  };
  const savePrivateNote = async (rel) => {
    setPrivateNoteBusy(true);
    setActionError('');
    try {
      await api.updateRelationship(rel.id, { private_note: privateNoteDraft.trim() || null });
      setPrivateNoteFor(null);
      load();
    } catch (cause) { setActionError(cause?.message || 'The private note could not be saved.'); }
    finally { setPrivateNoteBusy(false); }
  };
  const setReminder = async (rel) => {
    setActionError('');
    if (!reminderDate) { setActionError('A reminder is a date — say when to re-surface the tie.'); return; }
    try {
      await api.partnerReminderSet(rel.id, { remind_at: reminderDate, note: reminderNote.trim() || null });
      setReminderFor(null); setReminderDate(''); setReminderNote('');
      load();
    } catch (cause) { setActionError(cause?.message || 'The reminder could not be set.'); }
  };
  const doneReminder = async (uid) => {
    setActionError('');
    try { await api.partnerReminderDone(uid, true); load(); }
    catch (cause) { setActionError(cause?.message || 'The reminder could not be updated.'); }
  };
  const resolveIntro = async (prop, decision) => {
    if (decision === 'accept' && (!creditView.canAccept || busyUid)) { setActionError(creditView.reason || 'Wait for the current introduction to finish.'); return; }
    setBusyUid(prop.uid); setActionError('');
    try {
      const result = decision === 'accept' ? await api.introAccept(prop.uid) : await api.introDecline(prop.uid);
      setIntroductions((current) => current && ({
        ...current,
        credits: result?.credits ?? null,
        propositions: current.propositions.map((item) => item.uid === prop.uid ? { ...item, status: decision === 'accept' ? 'accepted' : 'declined' } : item),
      }));
    } catch (error) {
      if (decision === 'accept') setIntroductions((current) => current && ({ ...current, credits: null }));
      if (error?.data?.error === 'credit_conflict') {
        // D4606: the debit lost a race and nothing was spent.
        setActionError('Your credits changed at the same moment. Nothing was spent. Try again.');
      } else if (error?.status === 409) {
        setActionError('This proposition changed elsewhere. The desk has been refreshed.');
        load(true);
      } else if (error?.status === 402 || error?.data?.code === 'intro_credits_exhausted') {
        setActionError('No introduction credits are currently available. Declining remains available.');
        if (error?.data?.credits) setIntroductions((current) => current && ({ ...current, credits: error.data.credits }));
      } else setActionError(error?.message || 'The proposition could not be updated.');
    } finally { setBusyUid(''); }
  };

  const bucket = bucketForPath('investor', '/network');
  // `Co-investors` is the only narrowing this store supports: `relationship_type`
  // is a CHECKed set and `co_investor` is one of its five values. `Everyone` is
  // the reset view, which is what the word means over a book the query has
  // already scoped to the reader.
  const coldRows = coldView(relationships || []);
  const coldIds = new Set(coldRows.map((row) => row.id));
  const coldest = relationships ? coldestDays(relationships) : null;
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const visibleRelationships = bookView === 'coinvestors'
    ? (relationships || []).filter((item) => item.relationship_type === 'co_investor')
    : bookView === 'founders'
      ? (relationships || []).filter((item) => String(item.other?.role || '') === 'founder')
      : bookView === 'cold'
        ? coldRows
        : (relationships || []);
  const touchCoverage = (relationships || []).filter((item) => lastTouchAt(item)).length;
  const coldCount = coldRows.length;
  // The op opens the reminder panel on the first row the current view shows —
  // under `Going cold` that is the first cold tie, under any other view the
  // first row. (Named for the table's handler key, not the state setter.)
  //
  // IT SITS BELOW `visibleRelationships` ON PURPOSE (D307). A hook's
  // dependency array is evaluated when the hook is called, during render, so
  // a memo placed above the `const` it depends on reads it in its temporal
  // dead zone and EVERY render throws. That shipped once and took every
  // investor /network zone down; investor_network_render_d307.test.mjs now
  // renders the page, and `no-use-before-define` in eslint.config.mjs refuses
  // the ordering in any component.
  //
  // #6259: it USED TO open the reminder form on the first row the view showed,
  // silently — a member pressed "Set reminders" and got a form for whoever
  // happened to sort first. It now opens the Reminders view: the open ones and
  // the done ones, each tie named. A new reminder is still set on its tie.
  const setRemindersOp = useMemo(() => ({
    onClick: () => {
      setActionError('');
      setReminderFor(null); setTouchFor(null); setPrivateNoteFor(null);
      setRemindersOpen(true);
    },
  }), []);
  const reminderTie = (r) => {
    const tie = (relationships || []).find((item) => Number(item.id) === Number(r.relationship_id));
    return tie ? personName(tie) : ([r.a_name, r.b_name].filter(Boolean).join(' · ') || 'Tie not recorded');
  };
  const { upcoming: upcomingReminders, done: doneReminders } = reminderLists(reminders);
  const pending = propositionRows.filter((item) => item.status === 'pending');

  // No zone means the overview, where every section shows. An unknown slug
  // would show nothing at all, so it is treated as no zone: the shell only
  // ever passes a slug out of its own bucket config, and a body that renders
  // the whole workspace is a better failure than a body that renders nothing.
  const known = zone === 'relationships' || zone === 'introductions' || zone === 'organizations';
  const shows = (section) => !known || zone === section;

  return (
    <main className="investor-network-workspace" data-testid="investor-network-workspace">
      {networkPickerNotice && <p role="status">{networkPickerNotice}</p>}
      {networkPicker === 'introduction' && <NetworkIntroOffer onClose={()=>setNetworkPicker(null)} onOffered={()=>{setNetworkPicker(null);setNetworkPickerNotice('Introduction offered. Each person chooses whether to accept.');}} />}
      {networkPicker === 'tie' && <NetworkTieRequest onClose={()=>setNetworkPicker(null)} onSent={()=>{setNetworkPicker(null);setNetworkPickerNotice('Tie requested. It counts only after the other person accepts.');}} />}
      <div className="inw-layout">
        <section className="inw-main">
          {!embedded && <header className="inw-hero">
            <div className="inw-title-row">
              <div><h1 data-testid="heading-investor-network">Work my relationships</h1><p>Typed for this side of the table: founders met, co-investors, LPs, service partners — each tie carrying the deal or fund context it belongs to.</p></div>
            </div>
            {/* Real links. These were three `href="#…"` anchors that scrolled
                and never opened /network/relationships, /introductions or
                /organizations. */}
            <ZoneNav bucket={bucket} role="investor" activeSlug={null} className="mt-2.5" />
          </header>}

          {shows('relationships') && <section className="inw-card" aria-labelledby="relationship-book">
            <SectionHeading id="relationship-book" title="Relationship book" detail={detailFor(errors.relationships, relationships, () => {
              const ties = relationships.length;
              // A book with no last-touch dates and an EMPTY book are different
              // facts. Only the first is a coverage gap.
              const touch = relationships.length === 0 ? 'no ties recorded'
                : errors.relationships ? 'last-touch coverage unavailable'
                  : touchCoverage ? `${coldCount} going cold` : 'no touches logged yet';
              return `${ties} ties · ${touch}`;
            })} role={role} filters={zoneFilters ? zoneFilters({ value: bookView, onChange: setBookView, counts: { cold: coldCount } }) : []} actions={investorZoneActions('network/relationships', { handlers: { addPerson: {onClick:()=>setNetworkPicker('tie'),title:'Ask someone you share a deal or data room with to accept a tie.'}, setReminders: setRemindersOp }, view: { header: ['Person', 'Organization', 'Type'], rows: visibleRelationships || [], cells: (r) => [personName(r), companyLine(r), r.relationship_type] } })} />
            <p className="inw-footnote" data-testid="tile-coldest">
              Coldest {relationships === null ? '— loading' : coldest == null ? '— not recorded (no tie is past the cold window)' : `— ${coldest}d`}
            </p>
            {actionError && <Alert><span data-testid="status-relationship-write">{actionError}</span></Alert>}
            {/* DUE REMINDERS: a date-only reminder is due on the viewer's day. */}
            {errors.reminders ? <Alert>{errors.reminders}</Alert> : (reminders || []).filter((r) => !r.done && reminderDue(r.remind_at, Date.now(), viewerZone)).length > 0 && (
              <div className="inw-alert" role="status" data-testid="status-due-reminders">
                <CircleAlert size={14} />
                <span>
                  {(reminders || []).filter((r) => !r.done && reminderDue(r.remind_at, Date.now(), viewerZone)).map((r) => {
                    const who = [r.a_name, r.b_name].filter(Boolean).join(' · ') || 'the tie';
                    return (
                    <span key={r.uid} className="mr-3">
                      {who}: {r.note || 'Re-surface this tie'} — due {r.remind_at}
                      <button type="button" onClick={() => doneReminder(r.uid)} data-testid={`button-reminder-done-${r.uid}`} className="ml-1 underline">Done</button>
                    </span>
                    );
                  })}
                </span>
              </div>
            )}
            {remindersOpen && (
              <div className="inw-reminders" id="network-reminders" data-testid="panel-reminders" aria-labelledby="reminders-heading" role="region">
                <div className="inw-reminders-head">
                  <h3 id="reminders-heading">Reminders</h3>
                  <button type="button" onClick={() => setRemindersOpen(false)} data-testid="button-reminders-close">Close</button>
                </div>
                {errors.reminders ? (
                  <div data-testid="reminders-unreadable"><Unreadable what="Your reminders" claim="This is not a claim that none exist." onRetry={() => load()} /></div>
                ) : reminders === null ? (
                  <div role="status" aria-busy="true" data-testid="reminders-loading"><Skeleton rows={2} /><p className="inw-footnote">Loading reminders…</p></div>
                ) : <>
                  <h4>Upcoming</h4>
                  {upcomingReminders.length === 0 ? <div className="inw-empty" data-testid="reminders-upcoming-empty">No reminder set. Set one on a tie with Remind me.</div> : (
                    <ul className="inw-history" data-testid="list-reminders-upcoming">
                      {upcomingReminders.map((r) => {
                        const due = reminderDue(r.remind_at, Date.now(), viewerZone);
                        return (
                          <li key={r.uid} data-testid={`reminder-upcoming-${r.uid}`}>
                            <time>{shortDate(r.remind_at) || 'Date not recorded'}</time>
                            <span className="inw-history-body"><strong>{reminderTie(r)}</strong> {r.note || 'Re-surface this tie'}</span>
                            <span className="inw-history-meta">{due ? <i className="inw-state inw-cold">Due</i> : <i className="inw-state">Upcoming</i>}
                              <button type="button" onClick={() => doneReminder(r.uid)} data-testid={`button-reminder-mark-done-${r.uid}`}>Mark done</button></span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <h4>Done</h4>
                  {doneReminders.length === 0 ? <div className="inw-empty" data-testid="reminders-done-empty">No reminder marked done.</div> : (
                    <ul className="inw-history" data-testid="list-reminders-done">
                      {doneReminders.map((r) => (
                        <li key={r.uid} data-testid={`reminder-done-${r.uid}`}>
                          <time>{shortDate(r.remind_at) || 'Date not recorded'}</time>
                          <span className="inw-history-body"><strong>{reminderTie(r)}</strong> {r.note || 'Re-surface this tie'}</span>
                          <span className="inw-history-meta"><i className="inw-state">{r.done_at ? `Done ${shortDate(r.done_at)}` : 'Done'}</i></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>}
              </div>
            )}
            {errors.relationships ? <Alert>{errors.relationships}</Alert> : relationships === null ? <Skeleton rows={5} /> : relationships.length === 0 ? <div className="inw-empty" data-testid="empty-relationship-book">No attributed relationship records are available yet.</div> : visibleRelationships.length === 0 ? <div className="inw-empty" data-testid="empty-relationship-view">{bookView === 'founders' ? `No tie with a founder account is recorded. ${relationships.length} ${relationships.length === 1 ? 'tie' : 'ties'} in the book in total.` : bookView === 'cold' ? `Nothing is going cold — every tie with a recorded touch is inside ${COLD_AFTER_DAYS} days, and a tie with none is unknown, not cold.` : `No co-investor tie is recorded. ${relationships.length} ${relationships.length === 1 ? 'tie' : 'ties'} in the book in total.`}</div> : (
              <div className="inw-table" data-testid="table-relationship-book">
                <div className="inw-table-head"><span>Person</span><span>Type</span><span>Strength</span><span>Context</span><span>Last touch</span></div>
                {visibleRelationships.map((item) => <div key={item.id}>
                  <div className="inw-table-row max-sm:grid-cols-2!" data-testid={`row-relationship-${item.id}`}>
                    <strong data-label="Person">{personName(item)}<span className="block font-normal text-[10px] opacity-75" data-testid={`text-relationship-company-${item.id}`}>{companyLine(item)}</span></strong><span data-label="Type"><i className="inw-type">{typeLabel(item.relationship_type)}</i></span>
                    <span data-label="Strength"><i className={`inw-strength ${coldIds.has(item.id) ? 'inw-cold' : Number(item.strength_score) >= 70 ? 'strong' : ''}`}>{coldIds.has(item.id) ? 'Going cold' : Number.isFinite(Number(item.strength_score)) ? `${Math.round(item.strength_score)}/100` : 'Not scored'}</i></span>
                    <span data-label="Context" className="inw-context">{relationshipContext(item)}</span>
                    <time data-label="Last touch" className={age(lastTouchAt(item)).includes('d') && Number.parseInt(age(lastTouchAt(item)), 10) > COLD_AFTER_DAYS ? 'inw-cold' : ''}>{age(lastTouchAt(item))}</time>
                    <span className="inw-row-actions max-sm:col-span-2">
                      {(() => {
                        // #6259: the tie's open reminder, read back. Nothing is
                        // drawn while the reminders load or when their read
                        // failed — the alert above says which.
                        const open = openReminderFor(reminders, item.id);
                        return open ? <i className="inw-state" data-testid={`text-open-reminder-${item.id}`}>Reminder {shortDate(open.remind_at) || 'date not recorded'}</i> : null;
                      })()}
                      <button type="button" onClick={() => openTouch(item)} data-testid={`button-log-touch-${item.id}`}>Log a touch</button>
                      <button type="button" onClick={() => { setActionError(''); setReminderFor(reminderFor === item.id ? null : item.id); setTouchFor(null); setPrivateNoteFor(null); }} data-testid={`button-remind-${item.id}`}>Remind me</button>
                      <button type="button" onClick={() => {
                        setActionError('');
                        const open = privateNoteFor === item.id ? null : item.id;
                        setPrivateNoteFor(open);
                        setPrivateNoteDraft(open ? (item.my_private_note || '') : '');
                        setTouchFor(null); setReminderFor(null);
                      }} data-testid={`button-private-note-${item.id}`}>Private note</button>
                    </span>
                    {role === 'investor' && <div style={{ gridColumn: '1 / -1' }}>{introAction([introTarget(item)].filter(Boolean))}</div>}
                  </div>
                  {touchFor === item.id && (<>
                    <div className="inw-inline-form" data-testid={`form-touch-${item.id}`}>
                      <input type="date" value={touchDate} onChange={(e) => setTouchDate(e.target.value)} aria-label="When it happened" data-testid={`input-touch-date-${item.id}`} />
                      <input value={touchNote} onChange={(e) => setTouchNote(e.target.value)} placeholder="What the last exchange was (kept to 2,000 characters)" aria-label="Touch note" maxLength={2000} />
                      <button type="button" onClick={() => logTouch(item)} data-testid={`button-touch-save-${item.id}`}>Record the touch</button>
                      <button type="button" onClick={() => setTouchFor(null)}>Cancel</button>
                    </div>
                    {/* #6259: the recorded touches, newest first — date, note,
                        who recorded it, voided or not. Void stays the
                        recorder's own (the route refuses anyone else's). */}
                    <div className="inw-touch-log" data-testid={`touch-log-${item.id}`}>
                      <h4>Recorded touches</h4>
                      {touchLogError ? (
                        <div data-testid="touch-log-unreadable"><Unreadable what="The touch log" claim="This is not a claim that none exist." onRetry={() => readTouchLog(item.id)} /></div>
                      ) : touchLog === null ? (
                        <div role="status" aria-busy="true" data-testid="touch-log-loading"><Skeleton rows={2} /><p className="inw-footnote">Loading recorded touches…</p></div>
                      ) : touchLog.length === 0 ? (
                        <div className="inw-empty" data-testid="touch-log-empty">No touch recorded</div>
                      ) : (
                        <ol className="inw-history" data-testid="list-touch-log">
                          {touchLog.map((row) => {
                            const mine = Number(row.recorded_by) === Number(user?.id);
                            return (
                              <li key={row.uid} className={row.voided_at ? 'inw-voided' : ''} data-testid={`touch-${row.uid}`}>
                                <time>{shortDate(row.interacted_at) || 'Date not recorded'}</time>
                                <span className="inw-history-body">{row.note || <em>No note recorded</em>}</span>
                                <span className="inw-history-meta">
                                  <span data-testid={`text-touch-recorder-${row.uid}`}>Recorded by {touchRecorder(row, user?.id, item.other?.id)}</span>
                                  {row.voided_at ? <i className="inw-state" data-testid={`status-touch-voided-${row.uid}`}>Voided</i> : null}
                                  {!row.voided_at && mine ? <button type="button" onClick={() => voidTouch(item, row.uid)} data-testid={`button-void-touch-${row.uid}`}>Void this touch</button> : null}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  </>)}
                  {privateNoteFor === item.id && (
                    <div className="inw-inline-form" data-testid={`form-private-note-${item.id}`}>
                      <input value={privateNoteDraft} onChange={(e) => setPrivateNoteDraft(e.target.value)} placeholder="Only you see this note (kept to 2,000 characters)" aria-label="Private note" data-testid={`input-private-note-${item.id}`} maxLength={2000} />
                      <button type="button" disabled={privateNoteBusy} onClick={() => savePrivateNote(item)} data-testid={`button-private-note-save-${item.id}`}>Save note</button>
                      <button type="button" onClick={() => setPrivateNoteFor(null)}>Cancel</button>
                    </div>
                  )}
                  {reminderFor === item.id && (
                    <div className="inw-inline-form" data-testid={`form-reminder-${item.id}`}>
                      <input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} aria-label="Remind on" data-testid={`input-reminder-date-${item.id}`} />
                      <input value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} placeholder="What to re-surface (optional, kept to 500 characters)" aria-label="Reminder note" maxLength={500} />
                      <button type="button" onClick={() => setReminder(item)} data-testid={`button-reminder-save-${item.id}`}>Set the reminder</button>
                      <button type="button" onClick={() => setReminderFor(null)}>Cancel</button>
                    </div>
                  )}
                </div>)}
              </div>
            )}
            {errors.summary && <p className="inw-footnote" data-testid="text-network-summary-unavailable">{errors.summary}</p>}
            {bookView === 'cold' && visibleRelationships.length > 0 && (
              <p className="inw-footnote" data-testid="text-reengagement-note">
                Re-engagement lines are not drafted here yet — that draft surface is being built separately, and the reminder you set above is the working half.
              </p>
            )}
          </section>}

          {(shows('introductions') || shows('organizations')) && <div className="inw-lower">
            {shows('introductions') && <section className="inw-card" aria-labelledby="introductions-desk">
              <SectionHeading id="introductions-desk" title="Introductions desk" detail={deskView === 'asked' ? detailFor(errors.asks, asks, () => `${askRows.length} ${askRows.length === 1 ? 'ask' : 'asks'} recorded`) : detailFor(errors.introductions, introductions, () => propositionScopes({ pending: pending.length, shown: visiblePropositions.length, filtered: deskRows.length, total: propositionRows.length, filteredView: deskView !== 'all' }))} role={role} filters={zoneFilters ? zoneFilters({ value: deskView, onChange: setDeskView }) : []} actions={investorZoneActions('network/introductions', { handlers: {offerIntroduction: {onClick:()=>setNetworkPicker('introduction'),title:'Offer an introduction between two of your accepted ties.'}}, view: deskView === 'asked' ? { header: ['Target', 'Status', 'Quarter', 'Asked'], rows: askRows, cells: (a) => [askTargetName(a, askNamesUnreadable), a.status, a.quarter, a.created_at] } : { header: ['Introduction', 'Status', 'Score', 'Source'], rows: deskRows, cells: (p) => [p.target?.name || p.target?.email, p.status, p.score, p.source] } })} />
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]" data-testid="intro-credit-summary">
                <span>Spendable intro credits · <strong>{creditView.label}</strong></span>
                <button type="button" className="min-h-11 font-semibold underline" onClick={() => load(true)} disabled={refreshing} data-testid="intro-credit-retry">{refreshing ? 'Reading…' : 'Refresh credits'}</button>
                {creditView.reason ? <p className="m-0 w-full text-axal-muted dark:text-gray-400" id="intro-credit-reason">{creditView.reason}</p> : null}
              </div>
              {deskView === 'asked' ? (
                errors.asks ? <Alert>{errors.asks}</Alert> : asks === null ? <Skeleton rows={4} /> : askRows.length === 0 ? <div className="inw-empty" data-testid="empty-asks">No introduction ask is recorded. One appears here when you request an intro.</div> : <>
                  <div className="inw-proposition-list">{askRows.map((ask) => <article className="inw-proposition" key={ask.uid} data-testid={`card-ask-${ask.uid}`}>
                    <div className="inw-prop-top"><span className="inw-prop-label">Asked · {ask.quarter || 'quarter not recorded'}</span><span className="inw-state" data-testid={`status-ask-${ask.uid}`}>{typeLabel(ask.status)}</span></div>
                    <strong data-testid={`target-ask-${ask.uid}`}>{askTargetName(ask, askNamesUnreadable)}</strong>
                    <p data-testid={`message-ask-${ask.uid}`}>{ask.message ? ask.message : 'No message was sent with this ask.'}</p>
                    <div className="inw-prop-actions"><span className="inw-state" data-testid={`date-ask-${ask.uid}`}>Asked {askDate(ask.created_at)} · {age(ask.created_at)}</span></div>
                  </article>)}</div>
                  <p className="inw-footnote">An ask’s status is written when you make it and nothing moves it yet — a reply is a conversation, not a row here.</p>
                </>
              ) : introductions === null ? (errors.introductions ? <Alert>{errors.introductions}</Alert> : <Skeleton rows={4} />) : propositionRows.length === 0 ? (errors.introductions ? <Alert>{errors.introductions}</Alert> : <div className="inw-empty" data-testid="empty-introductions">No live introduction propositions. New matches appear here when available.</div>) : <>
                {errors.introductions ? <Alert>{errors.introductions} Previously loaded propositions remain below.</Alert> : null}
                {actionError && <Alert>{actionError}</Alert>}
                <div className="inw-proposition-list">{visiblePropositions.map((prop) => {
                  const target = prop.target || {}; const active = prop.status === 'pending'; const busy = busyUid === prop.uid;
                  return <article id={`network-intro-${safeKey(prop.uid)}`} className={`inw-proposition ${active ? 'featured' : ''} ${highlightedIntro === prop.uid ? 'highlighted' : ''}`} key={prop.uid} data-testid={`card-introduction-${prop.uid}`}>
                    <div className="inw-prop-top"><span className="inw-prop-label">Proposal · {prop.source || 'network'}</span><span className="inw-score" data-testid={`text-intro-score-${prop.uid}`}>{prop.source==='offered'?'Match not recorded':Number.isFinite(Number(prop.score)) ? `${prop.score} match` : 'Match pending'}</span></div>
                    <strong>{target.name || target.email || 'Proposed introduction'}</strong>
                    <p>{introductionContext(prop)}</p>
                    <p data-testid={`intro-counterpart-${prop.uid}`}>Other side: {counterpartAnswer(prop.counterpart_status)}</p>
                    {active ? <p className="inw-footnote" data-testid={`intro-cost-${prop.uid}`}>Accepting uses 1 credit</p> : null}
                    <div className="inw-prop-actions">{active ? <><button type="button" onClick={() => resolveIntro(prop, 'accept')} disabled={busy || Boolean(busyUid) || !creditView.canAccept} aria-describedby={creditView.reason ? 'intro-credit-reason' : undefined} data-testid={`button-accept-intro-${prop.uid}`}><Check size={12} />{busy ? 'Working' : 'Accept intro'}</button><button type="button" className="quiet" onClick={() => resolveIntro(prop, 'decline')} disabled={busy} data-testid={`button-decline-intro-${prop.uid}`}><X size={12} />Decline</button></> : <span className="inw-state" data-testid={`status-intro-${prop.uid}`}>{typeLabel(prop.status)}</span>}{(prop.screened === true || prop.screening_status === 'screened') && <span className="inw-screened" data-testid={`status-intro-screened-${prop.uid}`}><ShieldCheck size={11} />Screened</span>}</div>
                  </article>;
                })}</div>
                {/* #4611 finding 7: the rest of the collection, reachable by
                    ordinary navigation. In the zone this extends the list; on
                    the overview it is a link to the zone, because an overview's
                    job is to point at the place the work is done. */}
                {morePropositions > 0 ? (inZone ? (
                  <div className="inw-prop-actions" data-testid="introductions-more">
                    <button type="button" onClick={() => setShown((n) => n + PROPOSITION_PAGE)}>
                      {`Show more (${visiblePropositions.length} of ${deskRows.length})`}
                    </button>
                  </div>
                ) : (
                  <p className="inw-footnote" data-testid="introductions-more-link">
                    <Link to="/network/introductions">{`Open Introductions to see all ${deskRows.length}`}</Link>
                  </p>
                )) : null}
              </>}
            </section>}

            {shows('organizations') && <section className="inw-card" aria-labelledby="organizations">
              <SectionHeading id="organizations" title="Organizations" detail={detailFor(errors.relationships, relationships, () => (orgsUnreadable ? 'Company lookup unavailable'
                : visibleOrganizations.length >= orgRows.length
                  ? `${orgRows.length} relationship-backed organizations`
                  : `${visibleOrganizations.length} of ${orgRows.length} relationship-backed organizations shown`))} role={role} filters={zoneFilters ? zoneFilters({ value: orgView, onChange: setOrgView }) : []} actions={investorZoneActions('network/organizations', { view: { header: ['Organization', 'People', 'Recorded types'], rows: orgRows, cells: (o) => [o.name, o.people.size, [...o.types].join(' + ')] } })} />
              {errors.relationships || orgsUnreadable ? (
                <div className="inw-alert" role="status" data-testid="status-organizations-unreadable">
                  <CircleAlert size={14} />
                  <span>{errors.relationships ? 'The relationships behind this directory could not be read.' : 'Your counterparts’ companies could not be read. This is not a claim that none are recorded.'}{' '}
                    <button type="button" className="underline" onClick={readRelationships} disabled={relationshipsReading} data-testid="button-organizations-retry">{relationshipsReading ? 'Reading…' : 'Try again'}</button>
                  </span>
                </div>
              ) : relationships === null ? <Skeleton rows={4} /> : orgRows.length === 0 ? (
                <div className="inw-empty" data-testid="empty-organizations">{orgView === 'co_investors' ? 'No organization with a co-investor contact is recorded.' : 'None of the people you have a tie with links a company on their account yet.'}</div>
              ) : <div className="inw-org-list">{visibleOrganizations.map((org) => {
                const linkedBy = [...org.people.values()].find((person) => person.name);
                return <div className="inw-org flex-wrap" key={org.key} data-testid={`row-organization-${safeKey(org.name)}`}>
                  <details className="w-full">
                    <summary className="min-h-11 cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="organization-disclosure">
                      <strong className="inline!">{org.name}</strong>{' · '}<b>{org.people.size} known</b>
                      <span>{org.profileId
                        ? (linkedBy ? `Linked by ${linkedBy.name}${linkedBy.role ? `, ${typeLabel(linkedBy.role)}` : ''}` : 'Linked on a counterpart’s account')
                        : 'Company name from the relationship · profile not confirmed'}</span>
                      {org.coInvestor && <span>Has a co-investor contact</span>}
                    </summary>
                    <ul className="mt-2 space-y-1" aria-label="Known people">
                      {[...org.people].map(([id, person]) => {
                        const touched = shortDate(person.lastTouch);
                        return <li key={id}>
                          {person.name || 'Name not recorded'}{person.role ? ` · ${typeLabel(person.role)}` : ''}
                          <span>{touched ? `Last touch ${touched}` : 'No recorded touch'}</span>
                        </li>;
                      })}
                    </ul>
                    {org.types.size > 0 && <span>{[...org.types].join(' · ')}</span>}
                  </details>
                  {introAction([...org.introTargets.values()])}
                </div>;
              })}</div>}
              {moreOrganizations > 0 ? (inOrgZone ? (
                <div className="inw-prop-actions" data-testid="organizations-more">
                  <button type="button" onClick={() => setOrgShown((n) => n + ORGANIZATION_PAGE)}>
                    {`Show more (${visibleOrganizations.length} of ${orgRows.length})`}
                  </button>
                </div>
              ) : (
                <p className="inw-footnote" data-testid="organizations-more-link">
                  <Link to="/network/organizations">{`Open Organizations to see all ${organizations.length}`}</Link>
                </p>
              )) : null}
              <p className="inw-footnote" data-testid="text-organizations-source">An organization here is the company the other person links on their own account, read as it stands now. A tie whose counterpart links none is not grouped. Names and email domains are never used to infer a firm.</p>
            </section>}
          </div>}
        </section>

        {!embedded && (
          <WorkerRail
            workspace="Network"
            role="investor"
            className="inw-rail"
            stance="Manual by default"
            note="Tables and relationship records work alone. No automated outreach is sent from this page, and nothing here creates a relationship, sends an introduction, or infers consent."
            coverage={[
              errors.relationships ? 'Relationship book unavailable'
                : relationships === null ? 'Reading the relationship book'
                  : `${relationships.length} attributed tie${relationships.length === 1 ? '' : 's'}`,
              // The credits balance is whatever the introductions service
              // reports. A missing balance renders as absent, never as zero.
              `Intro credits · ${creditView.label}`,
            ]}
            coverageNote="Credit availability is supplied by the introductions service. Declining a proposition uses no credit."
            unavailable={[
              ['Outreach drafting', 'No message, sequence or introduction is written here. Every send is a human click.'],
              ['Consent', 'An accepted introduction stays a reviewed proposition. Both parties’ consent and the recorded scope govern what can be shared.'],
            ]}
            action={(
              <button type="button" onClick={() => load(true)} disabled={refreshing} data-testid="button-refresh-network">
                <RefreshCw size={13} className={refreshing ? 'inw-spin' : ''} /> Refresh records
              </button>
            )}
          />
        )}
      </div>
    </main>
  );
}

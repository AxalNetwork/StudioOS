/**
 * #5310 (D5310) — the founder's Network overview, built to the #4799 canvas (D4799): NW1 populated,
 * NW1.2 first run and NW5's data states. `/network` for a founder; the three zones are one pill away.
 *
 * WHAT IT READS, each on its own so one failure never blanks the page:
 *   book          GET /api/contacts/book                       the relationship book's total (D1352)
 *   followUps     GET /api/contacts/book/follow-ups-due        overdue follow-ups, oldest due first (#5310, B1)
 *   summary       GET /api/relationships/summary               decisions waiting, made in 90 days, sharing (D4464)
 *   pending, accepted, made
 *                 GET /api/relationships/intro-requests?status=…  the request log and its whole-log totals (D4611)
 *   propositions  GET /api/introductions/propositions?status=pending  curated matches and the credit balance
 *   contacts      GET /api/contacts                            only the re-engagement band's project (D551)
 *
 * A read that fails is Could not be read with Retry, never zero; a refresh that fails after an earlier
 * read keeps that read and says when it was made (NW5). Relationship strength and the activity feed
 * have no store and say Not recorded with why (D5310 § Backend required).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Network, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { contactsBookApi } from '../../lib/api/contacts';
import { relationshipsApi } from '../../lib/api/relationships';
import { WorkerRail } from '../../ui';
import { ASSIST_SURFACES } from '../../ui/eadwynConfig';
import ZoneDraft from '../../workspaces/ZoneDraft';
import useAssistMode from '../../hooks/useAssistMode';
import useAiSpend from '../../hooks/useAiSpend';
import { isCold, daysSince } from '../../lib/networkBook';
import { zonePillClass } from './deskZoneNav';
import './founderNetworkDesk.css';
import { LensNavLink, useLensGo } from '../../workspaces/lens';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import WhoKnowsStrip from '../relationships/WhoKnowsStrip.jsx';
import { reportError } from '../../lib/log';
import {
  ACTIVITY_NOT_RECORDED, ADD_PERSON_UNBUILT, NOT_RECORDED, READ_LOADING, STRENGTH_NOT_RECORDED, UNREADABLE,
  acceptGate, attentionRows, introGroups, isFirstRun, matchesView, minutesAgo, overviewTiles, settle, sharingLine, staleNotice,
} from './networkOverviewModel';

export const listFrom = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
export const normalizeRelationships = (value) => listFrom(value, 'items');
export const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/**
 * The three zones, in the chip row's order, and the one list the cards take their handoffs from — so a
 * card cannot hand off to a page the row does not name (`founder_overview_subpage_links`).
 */
const SECTIONS = [
  ['Relationships', '/network/relationships'],
  ['Introductions', '/network/introductions'],
  ['Organizations', '/network/organizations'],
];
const ZONE = Object.fromEntries(SECTIONS.map(([label, to]) => [label, to]));

/** Each read, by key. One place, so Retry re-reads exactly the card's own source. */
export const SOURCES = {
  book: () => contactsBookApi.book('', 1),
  followUps: () => contactsBookApi.followUpsDue(3),
  summary: () => relationshipsApi.summary(),
  pending: () => relationshipsApi.introRequests({ status: 'pending' }),
  accepted: () => relationshipsApi.introRequests({ status: 'accepted' }),
  made: () => relationshipsApi.introRequests({ status: 'made' }),
  propositions: () => api.introPropositions({ status: 'pending' }),
  contacts: () => api.contactsList(),
};
const STALE_LABELS = { book: 'Connections', followUps: 'Follow-ups', summary: 'Team requests', pending: 'Introductions', accepted: 'Introductions', made: 'Introductions', propositions: 'Curated matches' };
const INTRO_KEYS = ['pending', 'accepted', 'made', 'summary'];

export default function FounderNetworkDesk() {
  const location = useLocation();
  const seed = location.state?.founderNetworkSeed;
  const [records, setRecords] = useState(() => seed?.records || Object.fromEntries(Object.keys(SOURCES).map((k) => [k, READ_LOADING])));
  // THE SWITCH THE TWO BANDS WAIT FOR (D551): re-engagement and intro email draft, never send.
  const [fillsOn] = useAssistMode('Network');
  const ai = useAiSpend({ enabled: fillsOn });

  const load = useCallback((keys = Object.keys(SOURCES)) => {
    let live = true;
    keys.forEach((key) => {
      SOURCES[key]().then((data) => ({ ok: true, data }), (e) => { reportError(`network:overview:${key}`, e); return { ok: false }; })
        .then((outcome) => { if (live) setRecords((prev) => ({ ...prev, [key]: settle(prev[key], outcome) })); });
    });
    return () => { live = false; };
  }, []);
  useEffect(() => load(), [load]);

  const tiles = useMemo(() => overviewTiles(records), [records]);
  const firstRun = isFirstRun(records);
  const stale = staleNotice(records, STALE_LABELS);
  const state = { founderNetworkSeed: { records } };
  const counts = { Relationships: tiles[0].value, Introductions: tiles[3].value };
  const contacts = listFrom(records.contacts?.data, 'items');
  return <main className="a6-network" data-testid="founder-network-desk"><div className="a6-canvas"><div className="a6-main">
    <header className="a6-hero">
      <span className="a6-kicker">Network · Relationship intelligence</span>
      <div className="ask-hero-top"><h1>Your network</h1><div className="a6-hero-actions"><HeaderAsk /><Link className="a6-primary" data-testid="link-network-request-intro" to={ZONE.Introductions} state={state}>Request introduction</Link></div></div>
      <p>Know who you can reach, which relationships need attention, and which introductions are moving.</p>
      <nav aria-label="Network desk sections">
        <span className={`${zonePillClass({ isActive: true })} a6-pill-current`} aria-current="page" data-testid="link-network-overview-anchor">Overview</span>
        {SECTIONS.map(([label, to]) => <LensNavLink data-testid={`link-network-${label.toLowerCase()}-anchor`} key={label} to={to} className={zonePillClass}>{label}{counts[label] != null && !firstRun ? <b className="a6-pill-count">{counts[label]}</b> : null}</LensNavLink>)}
      </nav>
      <SectionPicker counts={firstRun ? {} : counts} state={state} />
    </header>
    {stale && <div className="a6-stale" role="status" data-testid="status-network-stale">
      <RefreshCw size={14} aria-hidden="true" />
      <span><strong>Partly out of date.</strong> {[...new Set(stale.what)].join(', ')} could not be refreshed. What you see below was read {stale.readAt ? `at ${String(stale.readAt).slice(11, 16)}, ${minutesAgo(stale.readAt)} minutes ago` : 'earlier'}.</span>
      <button type="button" data-testid="button-network-refresh-stale" onClick={() => load(stale.keys)}>Refresh</button>
    </div>}
    {firstRun
      ? <FirstRun records={records} state={state} />
      : <Overview records={records} tiles={tiles} load={load} state={state} fillsOn={fillsOn} ai={ai} coldScope={coldestProject(contacts)} />}
  </div><WorkerRail
    workspace="Network"
    className="a6-rail"
    stance="Drafts, never sends"
    // The switch for the re-engagement and intro-email bands (D551). They draft and change nothing.
    fills
    note={ASSIST_SURFACES.workspace.desks.Network.fills}
    coverage={[
      tiles[0].value != null ? `${tiles[0].value} ${tiles[0].value === 1 ? 'person' : 'people'} in your relationship book` : 'Relationship book not read',
      tiles[1].value != null ? `${tiles[1].value} overdue follow-up${tiles[1].value === 1 ? '' : 's'}` : 'Follow-ups not read',
      tiles[3].value != null ? `${tiles[3].value} active introduction${tiles[3].value === 1 ? '' : 's'}` : 'Introductions not read',
    ]}
    footer="Drafts only · nothing is sent"
  /></div></main>;
}

/**
 * The project the re-engagement band drafts for: the coldest project-linked contact's. The band writes
 * one note, to the person longest without contact, and the surface is scoped to one project.
 */
export function coldestProject(contacts) {
  const cold = contacts.filter((row) => isCold(row) && row.project_id != null);
  if (!cold.length) return null;
  cold.sort((a, b) => (daysSince(b.last_activity_at) ?? 0) - (daysSince(a.last_activity_at) ?? 0));
  return String(cold[0].project_id);
}

function Overview({ records, tiles, load, state, fillsOn, ai, coldScope }) {
  const attention = attentionRows(records.followUps);
  const groups = introGroups(records);
  const followUps = records.followUps;
  return <div className="a6-sections">
    <div className="a6-tiles" data-testid="network-tiles">{tiles.map((t) => <Tile key={t.key} tile={t} state={state} onRetry={() => load(t.key === 'connections' ? ['book'] : t.key === 'attention' ? ['followUps'] : t.key === 'decide' ? ['summary'] : ['pending', 'accepted'])} />)}</div>
    <div className="a6-pair a6-pair-wide">
      <section className="a6-card a6-relationships" id="a6-relationships" data-testid="card-network-attention">
        <Head title="Relationships needing attention" meta={followUps.status === 'ready' || followUps.status === 'stale' ? `${followUps.data.total} · oldest due first` : null} />
        {followUps.status === 'loading' ? <Skeleton rows={3} />
          : followUps.status === 'unreadable' ? <Unread what="Follow-ups" onRetry={() => load(['followUps'])} />
            : attention.length ? <ul className="a6-rows">{attention.map((r) => <li key={r.key} data-testid={`row-attention-${r.key}`}><span className="a6-avatar" aria-hidden="true">{r.initials}</span><span className="a6-row-text"><strong>{r.who}</strong><small>{r.line}</small></span><span className="a6-chip is-warn">◷ {r.overdue}</span><DeskLink testid={`link-attention-open-${r.key}`} to={ZONE.Relationships} state={state}>Open</DeskLink></li>)}</ul>
              : <Empty title="Nothing overdue." body="No follow-up on your book is past its due date." />}
        <p className="a6-note" data-testid="text-network-strength"><span aria-hidden="true">i</span> {STRENGTH_NOT_RECORDED}</p>
        {fillsOn && coldScope ? <ZoneDraft
          surface="network/re-engagement"
          scopeKey={coldScope}
          railOption="draft:network/re-engagement"
          ai={ai}
          accent="violet"
          label="Proposal · re-engagement"
          run="Draft a re-engagement note"
          accept="Accept the note"
          empty="Nothing proposed yet. Eadwyn will read the contacts going cold on this startup — how long since each was touched and what they last wrote — and draft one note to the person longest without contact."
          nothingToDraft="Nobody on this startup is going cold."
          foot="A note opens on what they last wrote, never on a check-in. Nothing is sent."
        /> : null}
        <DeskLink testid="link-open-network-relationships" to={ZONE.Relationships} state={state}>{followUps.status === 'ready' || followUps.status === 'stale' ? `All ${followUps.data.total} in Relationships` : 'Open relationships'}</DeskLink>
      </section>
      <section className="a6-card" id="a6-introductions" data-testid="card-network-introductions">
        <div className="a6-head"><h2>Introductions in progress</h2><button type="button" className="a6-icon-button" aria-label="Refresh introductions" title="Refresh introductions" onClick={() => load(INTRO_KEYS)} data-testid="button-network-refresh-intros"><RefreshCw size={14} aria-hidden="true" /></button></div>
        {groups.every((g) => g.state === 'unreadable')
          ? <Unread what="Introductions" note="Your requests are safe; this view failed to load them. Nothing is shown as zero." onRetry={() => load(INTRO_KEYS)} />
          : groups.every((g) => g.state !== 'loading' && g.state !== 'unreadable' && !g.rows.length && !g.count)
            ? <Empty title="No introductions in progress." body="When you ask a teammate for an introduction, it appears here." />
            : groups.map((g) => <IntroGroup key={g.key} group={g} onRetry={() => load(g.key === 'decide' || g.key === 'waiting' ? ['pending'] : g.key === 'accepted' ? ['accepted'] : ['made', 'summary'])} />)}
        <p className="a6-note">Accepted and Made are separate recorded states. Declined and withdrawn live in Introductions.</p>
        {fillsOn ? <ZoneDraft
          surface="network/intro-email"
          railOption="draft:network/intro-email"
          ai={ai}
          accent="violet"
          label="Proposal · intro email"
          run="Draft an intro email"
          accept="Accept the email"
          empty="Nothing proposed yet. Eadwyn will read the introductions you have accepted and the reasons each match recorded, and draft a forwardable email asking for the first."
          nothingToDraft="No accepted introduction is in motion."
          foot="Written from the match's recorded reasons only. Nothing is sent."
        /> : null}
        <DeskLink testid="link-open-network-introductions" to={ZONE.Introductions} state={state}>All introductions</DeskLink>
      </section>
    </div>
    <div className="a6-pair">
      <section className="a6-card" data-testid="card-network-activity">
        <Head title="Recent network activity" meta="recorded events only" />
        <Empty title={NOT_RECORDED} body={ACTIVITY_NOT_RECORDED} />
      </section>
      <WarmPath />
    </div>
    <Matches read={records.propositions} onRetry={() => load(['propositions'])} onChanged={() => load(['propositions', 'pending', 'accepted'])} state={state} />
    <DeskLink testid="link-open-network-organizations" to={ZONE.Organizations} state={state}>Open organizations</DeskLink>
  </div>;
}

function Tile({ tile, state, onRetry }) {
  return <section className={`a6-tile is-${tile.state}${tile.mark ? ' is-marked' : ''}`} data-testid={`tile-network-${tile.key}`} aria-busy={tile.state === 'loading' || undefined}>
    <span className="a6-tile-label">{tile.label}</span>
    {tile.state === 'loading' ? <><i className="a6-tile-skel" aria-hidden="true" /><small>Loading…</small></>
      : tile.state === 'unreadable' ? <><strong className="a6-tile-unread"><span aria-hidden="true">?</span> {UNREADABLE}</strong><small>This is not zero.</small><button type="button" className="a6-retry" onClick={onRetry} data-testid={`button-retry-tile-${tile.key}`}>Retry</button></>
        : <><strong>{tile.value}</strong><small>{tile.mark ? <span aria-hidden="true" className="a6-tile-mark">{tile.mark}</span> : null}{tile.sub}{tile.state === 'stale' ? ' · out of date' : ''}</small>{tile.href ? <Link className="a6-link" to={tile.href} state={state} data-testid={`link-tile-${tile.key}`}>Open <ArrowUpRight size={12} /></Link> : null}</>}
  </section>;
}

/**
 * NW8: below 600px the section pills become one Section picker, as the phone
 * board draws it. Each choice opens its zone the way its pill does (a lens on a
 * phone, D575). From 600px up it is hidden and the pills are the control.
 */
function SectionPicker({ counts, state }) {
  const go = useLensGo();
  return <label className="a6-section-picker" data-testid="network-section-picker">
    <span className="a6-kicker">Section</span>
    <select aria-label="Network section" value="" onChange={(e) => { if (e.target.value) go(e.target.value, state); }} data-testid="select-network-section">
      <option value="">Overview</option>
      {SECTIONS.map(([label, to]) => <option key={label} value={to}>{counts[label] != null ? `${label} · ${counts[label]}` : label}</option>)}
    </select>
  </label>;
}

function IntroGroup({ group, onRetry }) {
  return <div className="a6-intro-group" data-testid={`group-intro-${group.key}`}>
    <h3>{group.title}{group.count != null ? ` · ${group.count}` : ''}</h3>
    {group.state === 'loading' ? <Skeleton rows={1} />
      : group.state === 'unreadable' ? <Unread what={group.title} onRetry={onRetry} />
        : group.rows.length ? <ul className="a6-rows">{group.rows.slice(0, 2).map((r) => <li key={r.key} data-testid={`row-intro-${r.key}`}><span className="a6-avatar" aria-hidden="true">{r.initials}</span><span className="a6-row-text"><strong>{r.title}</strong><small>{r.line}</small></span><span className={`a6-chip ${group.key === 'decide' ? 'is-warn' : group.key === 'made' ? 'is-ok' : ''}`}>{r.chip}</span><Link className="a6-row-action" to={r.href}>{r.action}</Link></li>)}</ul>
          : <p className="a6-quiet">None.</p>}
  </div>;
}

/** NW1's "Find a warm path": the who-knows read and its ask, as Network › Relationships has it (D1356). */
function WarmPath() {
  const [kind, setKind] = useState('person');
  const [value, setValue] = useState('');
  const [query, setQuery] = useState(null);
  const placeholder = kind === 'person' ? 'LinkedIn URL or email' : kind === 'company' ? 'Company name' : 'Fund name';
  return <section className="a6-card" data-testid="card-network-warm-path">
    <Head title="Find a warm path" meta={null} />
    <p className="a6-quiet">Search a person by LinkedIn URL or email, or a company or fund by name. Only teammates who share their book are searched.</p>
    <form className="a6-warm" onSubmit={(e) => { e.preventDefault(); if (value.trim()) setQuery({ [kind]: value.trim() }); }}>
      <div role="radiogroup" aria-label="Search for" className="a6-seg">{[['person', 'Person'], ['company', 'Company'], ['fund', 'Fund']].map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'is-on' : undefined} onClick={() => { setKind(k); setQuery(null); }}>{label}</button>)}</div>
      <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} data-testid="input-network-warm-path" />
      <button type="submit" className="a6-primary" disabled={!value.trim()} data-testid="button-network-warm-path">Find who knows them</button>
    </form>
    {query ? <WhoKnowsStrip query={query} subject={query.person || (query.company ? `someone at ${query.company}` : `someone at ${query.fund}`)} testId="network-warm-path" /> : null}
    <p className="a6-note">Teammates’ private notes and email addresses are never shown here.</p>
  </section>;
}

/** "People you may know": curated matches. Accept spends one credit and is off against an unread balance. */
function Matches({ read, onRetry, onChanged, state }) {
  const view = matchesView(read);
  const gate = acceptGate(view.credits);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const act = async (uid, accept) => {
    setBusy(uid); setErr('');
    try { await (accept ? api.introAccept(uid) : api.introDecline(uid)); onChanged(); }
    catch (e) { setErr(e?.status === 402 ? 'Accepting needs 1 credit, and none is left. Nothing was spent.' : 'That did not save. Nothing was spent. Try again.'); }
    finally { setBusy(null); }
  };
  return <section className="a6-card" data-testid="card-network-matches">
    <Head title="People you may know" meta="curated matches" />
    {view.state === 'loading' ? <Skeleton rows={2} /> : view.state === 'unreadable' ? <Unread what="Curated matches" onRetry={onRetry} /> : <>
      <p className="a6-credits" data-testid="text-network-credits">Spendable intro credits <strong>{view.credits.state === 'unreadable' ? <><span aria-hidden="true">?</span> {UNREADABLE}</> : view.credits.balance}</strong></p>
      {view.rows.length ? <ul className="a6-matches">{view.rows.slice(0, 3).map((m) => <li key={m.uid} data-testid={`row-match-${m.uid}`}>
        <div className="a6-match-head"><span className="a6-avatar" aria-hidden="true">{m.initials}</span><span className="a6-row-text"><strong>{m.name}</strong><small>{m.headline || 'Headline not recorded'}</small></span>{m.expires ? <span className="a6-chip">◷ Expires {m.expires}</span> : null}</div>
        <p className="a6-quiet">Why: {m.why || NOT_RECORDED}.</p>
        <p className="a6-quiet" data-testid={`text-match-gate-${m.uid}`}>{gate.note}</p>
        <div className="a6-match-actions"><button type="button" disabled={busy === m.uid} onClick={() => act(m.uid, false)} data-testid={`button-match-decline-${m.uid}`}>Decline</button><button type="button" className="a6-primary" disabled={!gate.enabled || busy === m.uid} onClick={() => act(m.uid, true)} data-testid={`button-match-accept-${m.uid}`}>Accept</button></div>
      </li>)}</ul> : <Empty title="No curated matches yet." body="Axal proposes introductions when your profile matches someone’s thesis." />}
      {err && <p className="a6-error" role="alert"><AlertCircle size={14} />{err}</p>}
      <DeskLink testid="link-open-network-matches" to={ZONE.Introductions} state={state}>All curated matches</DeskLink>
    </>}
  </section>;
}

/** NW1.2: an empty book, no introductions and no matches — read, not assumed. */
function FirstRun({ records, state }) {
  const sharing = sharingLine(records.summary);
  const credits = matchesView(records.propositions).credits;
  return <div className="a6-sections" data-testid="network-first-run">
    <section className="a6-card a6-relationships">
      <span className="a6-kicker">Start here</span>
      <Head title="Build your relationship book" meta={null} />
      <p className="a6-quiet">Your book is private to you. Teammates only see that you know someone if you choose to share it.</p>
      <ol className="a6-steps">
        <li><b>1</b><div><strong>Import LinkedIn</strong><p>Bring your existing professional relationships into your private Network book. Upload the Connections CSV LinkedIn emails you. Possible duplicates wait for your review; nothing is merged on its own.</p><Link className="a6-primary" to="/account/connectors/linkedin" data-testid="link-network-import-linkedin">Import from LinkedIn</Link></div></li>
        <li><b>2</b><div><strong>Add person</strong><p>Add someone you already know without inviting them to Axal. They are not contacted. Inviting someone to Axal is a separate action.</p><button type="button" disabled title={ADD_PERSON_UNBUILT} aria-describedby="network-add-person-why" data-testid="button-network-add-person">Add person</button><small id="network-add-person-why">{ADD_PERSON_UNBUILT}</small></div></li>
        <li><b>3</b><div><strong>Request introduction</strong><p>Find someone in your permitted network who can introduce you. Search by LinkedIn URL or email. Only teammates who share their book are searched.</p><Link className="a6-primary" to={ZONE.Introductions} state={state} data-testid="link-network-first-request">Request introduction</Link></div></li>
      </ol>
      <p className="a6-note"><span aria-hidden="true">i</span> Network becomes more useful as your relationship book, team sharing, and introduction history grow.</p>
    </section>
    <div className="a6-pair">
      <section className="a6-card"><Head title="Introductions" meta={null} /><p className="a6-quiet">None yet. Requests you send or receive from your team appear here.</p></section>
      <section className="a6-card"><Head title="Curated matches" meta={null} /><p className="a6-quiet">No curated matches yet. Axal proposes introductions when your profile matches someone’s thesis.</p><p className="a6-credits">Spendable intro credits: <strong>{credits.state === 'unreadable' ? UNREADABLE : credits.balance}</strong></p></section>
    </div>
    <section className="a6-card" data-testid="card-network-sharing"><Head title="Team sharing" meta={null} /><p className="a6-quiet" data-testid="text-network-sharing">{sharing.text}</p><DeskLink testid="link-network-sharing" to={ZONE.Relationships} state={state}>Sharing settings</DeskLink></section>
    <DeskLink testid="link-open-network-organizations" to={ZONE.Organizations} state={state}>Open organizations</DeskLink>
  </div>;
}

function Unread({ what, note, onRetry }) {
  return <div className="a6-unread" role="alert"><AlertCircle size={15} aria-hidden="true" /><div><strong>{what} could not be read.</strong><p>{note || 'This is not zero.'}</p></div><button type="button" onClick={onRetry}>Retry</button></div>;
}
function Head({ title, meta }) { return <div className="a6-head"><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div>; }
function Empty({ title, body }) { return <div className="a6-empty"><Network size={17} /><div><strong>{title}</strong>{body && <p>{body}</p>}</div></div>; }
function Skeleton({ rows }) { return <div className="a6-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="a6-link" to={to} state={state}>{children}<ArrowUpRight size={13} /></Link>; }

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, RefreshCw, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import { NOT_RECORDED, text, titleCase } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import { STRENGTHS, coldBookView, coldestBookDays, daysSince, followUp, isCold, lastNote, organizationOf, strengthLabel } from '../../lib/networkBook';
import './founderNetworkRelationships.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { LensLink } from '../../workspaces/lens';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const title = (value) => titleCase(value) || NOT_RECORDED;
/**
 * One contact's strength and organisation, edited in place (D551). Saves
 * through `PUT /api/contacts/:uid`, which only the contact's owner may call;
 * a failed save says so and keeps what was stored.
 */
/** What a save sends: a blank clears the value (null), never an empty string. */
export const profileBody = (strength, organization) => ({
  strength: strength || null,
  organization: String(organization || '').trim() || null,
});

export function ContactProfileEditor({ row, onSaved, save = (uid, body) => api.contactUpdate(uid, body) }) {
  const [strength, setStrength] = useState(row.strength || '');
  const [organization, setOrganization] = useState(organizationOf(row));
  const [state, setState] = useState('idle');
  const dirty = strength !== (row.strength || '') || organization.trim() !== organizationOf(row);
  const submit = async (event) => {
    event.preventDefault();
    setState('saving');
    try {
      const fresh = await save(row.uid, profileBody(strength, organization));
      setState('saved');
      onSaved?.(fresh);
    } catch {
      setState('failed');
    }
  };
  return <form className="fn-rel-edit" onSubmit={submit} data-testid={`form-contact-profile-${row.id || row.uid}`}>
    <select aria-label={`Strength for ${text(row.name, 'this contact')}`} value={strength} onChange={(e) => { setStrength(e.target.value); setState('idle'); }}>
      <option value="">Not recorded</option>
      {STRENGTHS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
    <input aria-label={`Organization for ${text(row.name, 'this contact')}`} value={organization} placeholder="Organization" maxLength={200}
      onChange={(e) => { setOrganization(e.target.value); setState('idle'); }} />
    <button type="submit" disabled={!dirty || state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save'}</button>
    {state === 'failed' ? <small className="is-cold" role="alert">Not saved. The stored values are unchanged.</small> : null}
    {state === 'saved' ? <small role="status">Saved</small> : null}
  </form>;
}

const lastTouch = (value) => {
  const days = daysSince(value);
  if (days === null) return 'Not recorded';
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/**
 * `embedded`: `workspaces/NetworkWorkspace` mounts this page inside
 * `workspaces/WorkspaceShell`, which already draws the crumb, the h1, the zone
 * pill row and the Worker AI rail. This page draws all four of its own, so
 * without this prop a founder on /network/relationships saw two of every piece
 * of chrome — two crumbs, two headings, two pill rows and two rails, each pair
 * saying something different. The advisor and investor arms of that workspace
 * have had this seam since #391 and #399; the founder arm never got it.
 *
 * It suppresses the page's own header and rail and drops the two-column grid
 * (`.fn-rel.is-embedded` in founderNetworkRelationships.css) — the shell owns
 * both columns now, and the page's `min-height:100vh` would otherwise stretch
 * a short zone the full viewport inside a container that is already full.
 */
export default function FounderNetworkRelationships({ embedded = false, role = 'founder', zoneFilters = null }) {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [project, setProject] = useState(null);
  // null until a contacts read SUCCEEDS. An empty array would render exactly as
  // a failed read does, which is the whole of finding 10.
  const [book, setBook] = useState(null);
  const [filter, setFilter] = useState('everyone');
  const [status, setStatus] = useState('loading');
  const [errors, setErrors] = useState([]);

  /**
   * #4611 findings 8 and 10 — THE PROJECT FILTER IS THE SERVER'S, AND A FAILED
   * CONTACTS READ IS NOT AN EMPTY BOOK.
   *
   * It used to call `api.contactsList()` with no arguments — one bounded page of
   * every project's contacts, capped at 500 — and then drop every row whose
   * `project_id` was not the selected startup. A founder with more than 500
   * contacts across their startups opened one startup's book and saw whichever
   * of its contacts happened to survive a cut made across all of them. The stat
   * block above it counted that accident and called it "In the book".
   *
   * And the state machine could not fail: `status` was `chosen ? 'ready' : …`,
   * so a REJECTED contacts read with a resolved project was `'ready'` —
   * rendering "In the book 0", "Going cold 0", and a table whose empty state
   * says "No matching project-linked contacts are recorded", which is a
   * statement of fact about the store. The only trace of the outage was a thin
   * banner above it. Zero was presented as a successfully read count, which is
   * the finding in one sentence.
   *
   * Now: the project goes to the Worker, which filters before it pages, and the
   * two reads have separate outcomes. `contacts` is null until a read succeeds
   * — never `[]`, because an empty array and an unread list render the same and
   * must not. `total` is the Worker's whole-scope count, so the tile stops
   * describing the page.
   */
  const load = async () => {
    setStatus('loading'); setErrors([]);
    const projectResult = await api.listProjects().then((v) => ({ status: 'fulfilled', value: v }), (e) => ({ status: 'rejected', reason: e }));
    const available = projectResult.status === 'fulfilled' ? list(projectResult.value, 'items', 'projects') : [];
    const requested = Number(requestedId);
    const chosen = available.find((item) => Number(item.id) === requested) || available[0] || (requestedId ? { id: requested, name: 'Selected startup' } : null);
    setProject(chosen);
    if (chosen && String(chosen.id) !== requestedId) {
      setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(chosen.id)); return next; }, { replace: true });
    }
    // The project the Worker filters on. Without one there is no book to read,
    // so no contacts request is made at all rather than one that would come
    // back as every project's newest page and be presented as this one's.
    const contactResult = chosen
      ? await api.contactsList({ project_id: chosen.id }).then((v) => ({ status: 'fulfilled', value: v }), (e) => ({ status: 'rejected', reason: e }))
      : null;
    const failed = [];
    if (projectResult.status === 'rejected') failed.push('startup list');
    if (contactResult?.status === 'rejected') failed.push('relationship contacts');
    setErrors(failed);
    if (contactResult?.status === 'fulfilled') {
      const payload = contactResult.value;
      setBook({
        rows: list(payload, 'items', 'contacts'),
        // THE WORKER'S SCOPES, NOT THE PAGE'S LENGTH. `total` is every contact
        // on this startup; `rows.length` is what came back in this page. The
        // tile below prints the first and says when they differ.
        total: Number.isFinite(Number(payload?.total)) ? Number(payload.total) : null,
        hasMore: payload?.has_more === true,
        cursor: payload?.next_cursor || null,
        loadingMore: false,
      });
    } else {
      setBook(null);
    }
    // 'unreadable' is its own state and it is the contacts read's, not the
    // project's: a resolved project with a failed book is unreadable, and the
    // page says so instead of drawing a book with nothing in it.
    setStatus(!chosen ? (failed.length ? 'error' : 'empty') : contactResult?.status === 'rejected' ? 'unreadable' : 'ready');
  };

  /** One more page, appended. The counts do not move: they were never the page's. */
  const loadMore = async () => {
    const cursor = book?.cursor;
    if (!cursor || !project?.id) return;
    setBook((b) => (b ? { ...b, loadingMore: true } : b));
    try {
      const payload = await api.contactsList({ project_id: project.id, cursor });
      setBook((b) => (b ? {
        ...b,
        rows: [...b.rows, ...list(payload, 'items', 'contacts')],
        hasMore: payload?.has_more === true,
        cursor: payload?.next_cursor || null,
        loadingMore: false,
      } : b));
    } catch {
      // The page already shown stays; only the attempt to extend it failed.
      setBook((b) => (b ? { ...b, loadingMore: false, moreFailed: true } : b));
    }
  };
  useEffect(() => { load(); }, [requestedId]);

  const contacts = book?.rows || [];
  const visible = useMemo(() => contacts.filter((row) => {
    const audience = String(row.audience || '').toLowerCase();
    if (filter === 'investors') return audience === 'investor';
    if (filter === 'advisors') return audience === 'advisor' || audience === 'mentor';
    if (filter === 'cold') return isCold(row);
    return true;
  }), [contacts, filter]);
  // #4611 finding 9: `contacts.filter(isCold)` handed the ROW INDEX to
  // `isCold`'s `now`, so the summary measured every contact against a clock of
  // 0, 1, 2 and found none cold — under a chip filter and a per-row cell that
  // used the real one. `coldBookView` takes `now` once for the whole list, so
  // the three readers cannot disagree and cannot straddle a midnight.
  const cold = coldBookView(contacts);
  const knownTypes = new Set(contacts.map((row) => row.audience).filter(Boolean));
  const query = project?.id ? `?project_id=${project.id}` : '';

  return <main className={`fn-rel${embedded ? ' is-embedded' : ''}`} data-testid="founder-network-relationships"><div className="fn-rel-shell"><section className="fn-rel-main">
    {!embedded && <header className="fn-rel-header"><div className="fn-rel-crumb"><Link to={`/network${query}`}><ArrowLeft size={13} /> Network</Link><span>‹</span><strong>Relationships</strong></div><div className="fn-rel-title-row"><div><h1>Relationship book</h1><p>Project-linked contacts, relationship context and explicit last activity.</p></div></div><nav aria-label="Network sections"><LensLink className="is-active" to={`/network/relationships${query}`}>Relationships</LensLink><LensLink to={`/network/introductions${query}`}>Introductions</LensLink><LensLink to={`/network/organizations${query}`}>Organizations</LensLink></nav></header>}
    {/* Outside the header on purpose. These three zones only ever render
        through NetworkWorkspace, which passes `embedded` and draws the crumb,
        heading and zone nav itself — so everything inside that guard is dead
        on the route a founder actually opens. The actions row placed in there
        rendered nowhere, which a source test cannot see and a browser found. */}
    <ZoneToolbar
      className="mt-3"
      role={role}
      filters={zoneFilters ? zoneFilters({ value: filter, onChange: setFilter }) : []}
      actions={founderZoneActions('network/relationships', { query, view: { scope: project?.name, header: ['Person', 'Email', 'Context', 'Type', 'Last activity'], rows: visible, cells: (r) => [r.name, r.email, r.landing_page_name || r.source, r.audience, r.last_activity_at] } })}
    />
    {errors.length > 0 && <div className="fn-rel-alert" data-testid="status-network-relationships-partial"><AlertCircle size={15} /><span>{`Some selected-project sources are unavailable: ${errors.join(', ')}.`}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {status === 'loading' && <RelationshipSkeleton />}
    {status === 'empty' && <NoProject />}
    {status === 'error' && !project && <NoProject error />}
    {/* #4611 finding 10: a failed contacts read is unreadable and retryable. It
        is NOT a book with nothing in it, and it draws no counts — zero is not
        a figure that was read here. */}
    {status === 'unreadable' && <section className="fn-rel-card fn-rel-unavailable" data-testid="status-network-relationships-unreadable" role="alert">
      <div className="fn-rel-card-head"><div><AlertCircle size={16} /><h2>Your relationship book could not be read</h2></div><span>Not an empty book</span></div>
      <strong>This is a failed read of the contacts store, not a startup with no contacts recorded.</strong>
      <p>Nothing is counted on this page while that is true: a zero here would be a figure nobody read. Try again, and if it keeps failing the contacts store is the thing to look at.</p>
      <button type="button" onClick={load}><RefreshCw size={13} /> Try again</button>
    </section>}
    {status === 'ready' && project && <><div className="fn-rel-context"><div><span>Selected startup</span><strong data-testid="text-network-relationships-project">{text(project.name)}</strong><small>{text(project.sector, 'Sector not recorded')}</small></div><div><span>Source</span><strong>Project-linked authorized contacts</strong><small>Strength and organization as you set them; follow-ups from each contact's tasks</small></div></div>
      {/* THE FOUR CHIPS MOVED UP INTO THE ZONE HEADER ROW, which is where the
          canvas draws them and where the ops half already sat. Same four
          labels, same four predicates, one row instead of two. What stays here
          is the link out, which is navigation rather than a view. */}
      <div className="fn-rel-tabs"><Link data-testid="link-open-network-relationships-workspace" to={`/network?mode=workspace&tab=contacts&project_id=${project.id}`}>Open contacts <ChevronRight size={13} /></Link></div>
      {/* #4611 finding 8 — EVERY COUNT HERE NAMES ITS SCOPE.
          "In the book" is the Worker's `total` for this startup, not the page's
          length; the note says so when a page is all that is loaded. The three
          derived tiles are over the rows ACTUALLY LOADED and say that in their
          notes, because they are computed from row fields a count cannot
          supply — scoring and last activity are per row. A tile that read
          "Strong 4" over a 200-row page of a 600-contact book would be a page
          figure under a whole-book label, which is the defect this closes. */}
      <div className="fn-rel-stats"><Stat label="In the book" value={book?.total ?? contacts.length} note={bookScope(book, knownTypes)} /><Stat label="Strong" value={contacts.filter((row) => row.strength === 'strong').length} note={`of ${contacts.length} loaded · ${contacts.filter((row) => !row.strength).length} not scored`} muted={!contacts.some((row) => row.strength === 'strong')} /><Stat label="Going cold" value={cold.length} note={`of ${contacts.length} loaded · past 60 days of explicit activity`} /><Stat label="Coldest" value={cold.length ? `${coldestBookDays(contacts)} d` : 'Unavailable'} note={cold.length ? 'From stored last activity' : 'No cold relationship recorded'} muted={!cold.length} /></div>
      {/* The rest of the book, when the Worker says there is more. Without this
          the cursor it returns has no reader and the fifth page is unreachable
          by ordinary navigation. */}
      {book?.hasMore ? <div className="fn-rel-tabs" data-testid="network-relationships-more">
        <button type="button" onClick={loadMore} disabled={book.loadingMore}>{book.loadingMore ? 'Loading…' : `Load more (${contacts.length} of ${book.total ?? '?'} loaded)`}</button>
        {book.moreFailed ? <small role="alert">That page could not be read. The contacts already loaded are unaffected.</small> : null}
      </div> : null}
      <section className="fn-rel-card"><div className="fn-rel-card-head"><div><UsersRound size={16} /><h2>The book</h2></div><span>Cold flag uses explicit last activity only</span></div><RelationshipTable rows={visible} onSaved={(fresh) => setBook((b) => (b ? { ...b, rows: b.rows.map((row) => (row.uid === fresh?.uid ? { ...row, ...fresh } : row)) } : b))} /><p className="fn-rel-note">Contact status is not relationship strength. A contact is flagged going cold when `last_activity_at` is more than 60 days old — and that column is stamped when the contact is created, so a record nobody has touched ages into this set on its 61st day. The flag is honest about the column it reads; the column does not yet distinguish a touch from an arrival.</p></section>
      <section className="fn-rel-card fn-rel-unavailable"><div className="fn-rel-card-head"><div><AlertCircle size={16} /><h2>What the book records</h2></div><span>Set by you</span></div><strong>Strength and organization are what you set on a contact; follow-ups and the last note come from its tasks and replies.</strong><p>None of them is derived from email domains, lead status, landing pages, or contact age. A contact nobody has scored reads Not recorded.</p></section>
    </>}
  </section>{!embedded && <RelationshipRail project={project} contacts={contacts} total={book?.total ?? null} cold={cold} errors={errors} />}</div></main>;
}

export function RelationshipTable({ rows, onSaved, save }) {
  if (!rows.length) return <div className="fn-rel-empty"><UsersRound size={18} /><div><strong>No matching project-linked contacts are recorded.</strong><p>This filter contains no stored relationship records.</p></div></div>;
  return <div className="fn-rel-table-wrap"><table><thead><tr><th>Person</th><th>Context</th><th>Type</th><th>Strength</th><th>Last touch</th><th>Follow-up</th><th>Last note</th><th>Edit</th></tr></thead><tbody>{rows.map((row, index) => {
    const due = followUp(row);
    return <tr key={row.id || row.uid || index} data-testid={`row-network-relationship-${row.id || index}`}><td><strong>{text(row.name, text(row.email, 'Name not recorded'))}</strong><small>{organizationOf(row) || (row.name && row.email ? row.email : 'Authorized contact')}</small></td><td>{text(row.landing_page_name, text(row.source, 'Context not recorded'))}</td><td>{title(row.audience)}</td><td>{strengthLabel(row)}</td><td><span className={isCold(row) ? 'is-cold' : ''}>{lastTouch(row.last_activity_at)}{isCold(row) ? ' · going cold' : ''}</span></td><td><span className={due.state === 'overdue' ? 'is-cold' : ''}>{due.text}</span></td><td>{lastNote(row)}</td><td><ContactProfileEditor row={row} onSaved={onSaved} {...(save ? { save } : {})} /></td></tr>;
  })}</tbody></table></div>;
}
/**
 * What "In the book" is counting, said out loud. The Worker's `total` covers
 * the whole startup; when only part of it is loaded the note says both numbers,
 * so the tile is never a page count wearing a collection's label.
 */
function bookScope(book, knownTypes) {
  const types = `${knownTypes.size} recorded type${knownTypes.size === 1 ? '' : 's'}`;
  if (!book) return types;
  if (book.total == null) return `${types} · count unavailable`;
  if (book.total > book.rows.length) return `${types} · ${book.rows.length} loaded of ${book.total}`;
  return `${types} · all loaded`;
}

function Stat({ label, value, note, muted }) { return <div className={muted ? 'is-muted' : ''}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function RelationshipRail({ project, contacts, total = null, cold, errors }) {
  return <WorkerRail
    workspace="Network"
    className="fn-rel-rail"
    stance="Read-only relationship coverage"
    note="This view does not draft outreach, set reminders, add people, export contacts, or change records."
    coverage={[project ? text(project.name) : 'No project selected']}
    coverageNote={errors.includes('relationship contacts') ? 'Contact source unavailable.' : `${total ?? contacts.length} project-linked contact${(total ?? contacts.length) === 1 ? '' : 's'} · ${cold.length} going cold in the ${contacts.length} loaded.`}
    unavailable={[['Re-engagement lines', 'Drafted on the Network desk, from the replies a contact has logged.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function RelationshipSkeleton() { return <div className="fn-rel-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }
function NoProject({ error }) { return <div className="fn-rel-no-project"><UsersRound size={22} /><h2>{error ? 'Startup source unavailable' : 'No startup is available'}</h2><p>Relationships are scoped to an authenticated startup and its stored contacts.</p><Link to="/network">Back to Network</Link></div>; }
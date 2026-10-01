import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
// ONE DEFINITION OF A LOCAL DAY, shared with the advisor's Delivery zone rather
// than re-written here. `sent_at` and `opened_at` are instants written by the
// worker's `nowIso()`, and that module's header argues why they go through the
// browser's own formatter while a stored calendar day must not.
import { shortMoment } from '../advisor/practice/deliveryTrail';

/**
 * Who among your advisors can read this startup's record, and how much of it.
 *
 * WHY IT SITS BESIDE THE DATA-ROOM GRANT rather than on the advisor's own page:
 * this is the founder deciding who sees their company, and the page they
 * already come to for that decision is this one. The two grants are different
 * mechanisms — one opens a room of files to an investor, one opens a client
 * record to an advisor — but they answer the same question, and splitting them
 * across two screens is how a founder ends up believing they revoked something
 * they did not.
 *
 * THREE TICKS, NOT ONE. Opening the project record is not the same as opening
 * the data room, and neither is the same as showing an advisor which OTHER
 * advisors this founder is working with. A single "share" button would force
 * the most sensitive of the three in order to grant the least, so each is its
 * own choice and each is named in the words that describe what it actually
 * exposes — particularly the third, which is about people rather than files.
 *
 * NOTHING HERE SENDS AN INVITATION, exactly as the data-room grant does not.
 * The address must already belong to an Axal advisor account, and the copy says
 * so rather than leaving a founder waiting for an email that will not arrive.
 */

const SCOPES = [
  ['scope_project', 'Their record — name, sector, stage, and the metrics you have entered',
    'The half a client brief is missing today.'],
  ['scope_data_room', 'The data room files you marked open',
    'Files you marked NDA-only stay hidden until that advisor has a signed NDA on file — shown to them as a count, never as names.'],
  ['scope_sessions', 'Your sessions with other advisors',
    'This shows the advisor who else you have been working with, and on what. It is the widest of the three; leave it off unless you mean it.'],
];

/**
 * Pushing ONE document to ONE advisor — task #104.
 *
 * `advisor_client_document_shares` shipped in migration 218 with a reader and
 * no writer, so `LibraryZone` has told every advisor that nobody can send them
 * a document. This is the control that makes that false, and it sits inside the
 * grant section for the reason the section's own docblock gives: a founder
 * deciding who sees their company should not have to find two screens to do it,
 * or they end up believing they revoked something they did not.
 *
 * IT IS DELIBERATELY SUBORDINATE TO THE GRANT ABOVE. A document is only ever
 * read inside the client brief, and the brief is reached through the grant — so
 * the worker refuses a share to an advisor with no live grant, and this picker
 * offers only advisors who have one. Offering an address the API would refuse
 * is how a control teaches the wrong model.
 */
function DocumentShares({ projectUid, grants, busyOuter }) {
  const [docs, setDocs] = useState([]);
  const [shares, setShares] = useState([]);
  const [docUid, setDocUid] = useState('');
  const [advisorEmail, setAdvisorEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const granted = (grants || []).filter((g) => g.status === 'active' && g.advisor_is_advisor);

  const load = useCallback(async () => {
    if (!projectUid) return;
    try {
      const [d, s] = await Promise.all([
        api.research.documents().catch(() => ({ items: [] })),
        api.advisorSharedDocuments(projectUid).catch(() => ({ items: [] })),
      ]);
      setDocs(d?.items || d || []);
      setShares(s?.items || []);
    } catch { /* the section above already reports a load failure */ }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!docUid || !advisorEmail || busy) return;
    setBusy(true); setNote(null);
    try {
      await api.advisorShareDocument(projectUid, { document_uid: docUid, email: advisorEmail });
      setDocUid(''); setNote('Sent.');
      await load();
    } catch (e) {
      setNote(e?.detail || e?.message || 'That did not save.');
    } finally { setBusy(false); }
  };

  const unshare = async (shareUid) => {
    setBusy(true); setNote(null);
    try { await api.advisorUnshareDocument(projectUid, shareUid); await load(); }
    catch (e) { setNote(e?.detail || e?.message || 'That did not save.'); }
    finally { setBusy(false); }
  };

  if (!granted.length) {
    return (
      <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        Grant an advisor access above before sending them a document — a shared document is
        only ever read inside their client brief, and the brief is reached through the grant.
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
      <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">Send a document</h4>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        One file, to one advisor, by name. This does not add it to any search index — it
        appears in that advisor&rsquo;s client brief for this startup and nowhere else.
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={docUid} onChange={(e) => setDocUid(e.target.value)}
          aria-label="Document to send"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">Choose a document…</option>
          {docs.map((d) => <option key={d.uid} value={d.uid}>{d.title || d.uid}</option>)}
        </select>
        <select
          value={advisorEmail} onChange={(e) => setAdvisorEmail(e.target.value)}
          aria-label="Advisor to send it to"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">Choose an advisor…</option>
          {granted.map((g) => <option key={g.uid} value={g.advisor_email}>{g.advisor_email}</option>)}
        </select>
        <button
          type="button" disabled={busy || busyOuter || !docUid || !advisorEmail} onClick={send}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {!docs.length && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Your library is empty — upload a document in Research before sending one.
        </p>
      )}
      {note && <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">{note}</p>}

      {shares.map((sh) => (
        <div key={sh.uid} className="flex items-start gap-3 border-t border-gray-100 py-2 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-gray-900 dark:text-gray-100">{sh.title || sh.document_uid}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Sent to {sh.advisor_email}</div>
            {!sh.advisor_is_advisor && (
              <div className="text-[11px] text-amber-700 dark:text-amber-500">
                This account is no longer an advisor, so the document reads as nothing.
              </div>
            )}
          </div>
          <button
            type="button" disabled={busy || busyOuter} onClick={() => unshare(sh.uid)}
            className="text-xs font-semibold text-gray-600 underline disabled:opacity-50 dark:text-gray-300"
          >
            Withdraw
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * WHAT MY ADVISORS HAVE SENT ME — and the only place in this product where an
 * open receipt is written.
 *
 * THE MIRROR OF `DocumentShares` ABOVE. That one is founder → advisor: one file,
 * pushed to one person. This is advisor → founder: the work products they have
 * sent, version by version, with the control that records having read one. The
 * section's own docblock argues why both live here — a founder deciding what
 * they see and share from their advisors should not need two screens.
 *
 * ONLY THE CLIENT CAN SAY A THING WAS READ. Migration 208's header, inherited by
 * 239, states it: `opened_at` is the client's to set, because an advisor-side
 * write would be the practice reporting a metric about itself. Their Delivery
 * page prints Unopened, Median to open and Never opened straight off this
 * button, and there is no advisor route that can move any of them. D73.
 *
 * FIRST OPEN WINS, so the button disappears once used rather than becoming a
 * counter: the worker stamps only where `opened_at IS NULL`, and a receipt that
 * moved every time it was viewed would be a last-read time pretending to be a
 * first-read one.
 *
 * WHERE A FOUNDER ACTUALLY FINDS IT, said plainly because it took a browser run
 * to establish: this whole section renders inside `DataRoomPage`, which
 * `/raise/data-room` mounts only under `?mode=workspace` — the canvas zone
 * `FounderRaiseDataRoom` is the default body, and its "Open workspace" link is
 * the way through. So the receipt is two clicks from the Raise bucket, exactly as
 * `DocumentShares` above it has always been. That is the right home for the
 * mirror of a control, and it is not the most discoverable place in the product;
 * if the advisor's tiles turn out to sit unopened, surfacing this list on the
 * canvas zone as well is the fix, not moving it.
 *
 * IT IS NOT GRANT-GATED, unlike everything above it, and that difference is
 * stated on the card. The grants are project-scoped; this list is keyed on the
 * reader's own account through the ENGAGEMENT, so it shows work from every
 * advisor under contract whether or not they were ever granted a record.
 */
function ReceivedWorkProducts() {
  const [state, setState] = useState({ loading: true, error: null, items: [], totals: null });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.listReceivedDeliverables();
      setState({ loading: false, error: null, items: res?.items || [], totals: res?.totals || null });
    } catch (e) {
      setState({
        loading: false,
        error: e?.detail || e?.message || 'Work products from your advisors did not load.',
        items: [], totals: null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (uid) => {
    setBusy(uid);
    try { await api.openReceivedDeliverableVersion(uid); await load(); }
    catch { /* the row simply stays unopened; the next load is the truth */ }
    finally { setBusy(''); }
  };

  if (state.loading) return null;
  if (state.error) {
    return (
      <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
        <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">From your advisors</h4>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">{state.error}</p>
      </div>
    );
  }

  const totals = state.totals || {};
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800" data-testid="received-pr3c">
      <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100">From your advisors</h4>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        Work products your advisors have sent you, newest first. Marking one open is the only
        record either of you has that it was read — nothing on their side can set it, and it is
        kept as the FIRST time you opened it rather than the last.
        {' '}This list comes from your engagements, not from the grants above, so it shows every
        advisor you are under contract with whether or not you opened your record to them.
      </p>

      {state.items.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Nothing has been sent to you yet. A draft your advisor has not sent does not appear
          here, which is deliberate: it is their work in progress until they hand it over.
        </p>
      ) : (
        <>
          <div className="mt-2 text-[11px] font-semibold text-gray-600 dark:text-gray-400">
            {totals.work_products} from {totals.advisors}
            {totals.advisors === 1 ? ' advisor' : ' advisors'}
            {totals.unread ? ` · ${totals.unread} unread` : ' · all read'}
          </div>
          <div className="mt-2 space-y-2">
            {state.items.map((item) => (
              <div key={item.uid} data-testid={`received-pr3c-${item.uid}`}
                className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">{item.title}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{item.advisor_name}</div>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {item.versions.map((v) => (
                    <li key={v.uid} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 text-gray-600 dark:text-gray-400">
                        <strong className="font-semibold text-gray-800 dark:text-gray-200">
                          {v.label || `v${v.version}`}
                        </strong>
                        {v.summary ? ` · ${v.summary}` : ''}
                        {v.sent_at ? ` · sent ${shortMoment(v.sent_at)}` : ''}
                      </span>
                      {v.opened_at ? (
                        <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">
                          Opened {shortMoment(v.opened_at)}
                        </span>
                      ) : (
                        <button type="button" disabled={busy === v.uid}
                          data-testid={`open-pr3c-${v.uid}`} onClick={() => open(v.uid)}
                          className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                          {busy === v.uid ? 'Recording…' : 'Mark open'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {item.versions.some((v) => v.link_url) && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {item.versions.filter((v) => v.link_url).map((v) => (
                      <a key={v.uid} href={v.link_url} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-violet-700 underline dark:text-violet-300">
                        Open {v.label || `v${v.version}`} ↗
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            <strong>Signing a work product off is not recorded anywhere yet.</strong> The store
            carries the column beside the open receipt, and nothing writes it — no screen on
            either side asks for a sign-off, so a control here would save a fact nobody reads.
          </p>
        </>
      )}
    </div>
  );
}

export default function AdvisorGrantSection({ projectUid }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [email, setEmail] = useState('');
  const [scopes, setScopes] = useState({ scope_project: true, scope_data_room: false, scope_sessions: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    if (!projectUid) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.advisorGrants(projectUid);
      setState({ loading: false, error: null, items: res?.items || [] });
    } catch (e) {
      setState({ loading: false, error: e?.detail || e?.message || 'Advisor access did not load.', items: [] });
    }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);

  const share = async () => {
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true); setNote(null);
    try {
      await api.advisorGrantCreate(projectUid, { email: address, ...scopes });
      setEmail(''); setNote('Shared.');
      await load();
    } catch (e) {
      setNote(e?.detail || e?.message || 'That did not save.');
    } finally { setBusy(false); }
  };

  const revoke = async (grantUid) => {
    setBusy(true); setNote(null);
    try { await api.advisorGrantRevoke(projectUid, grantUid); await load(); }
    catch (e) { setNote(e?.detail || e?.message || 'That did not save.'); }
    finally { setBusy(false); }
  };

  if (!projectUid) return null;

  return (
    <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Advisors</h3>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        An advisor cannot read your record unless you open it. Choose what they see — each
        line is a separate decision, and you can revoke any of them at any time.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="email" value={email} placeholder="advisor@example.com"
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="button" disabled={busy || !email.trim()} onClick={share}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Share
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {SCOPES.map(([key, label, why]) => (
          <li key={key} className="flex gap-2">
            <input
              id={`adv-${key}`} type="checkbox" checked={scopes[key]} className="mt-0.5"
              onChange={(e) => setScopes({ ...scopes, [key]: e.target.checked })}
            />
            <label htmlFor={`adv-${key}`} className="text-xs leading-relaxed">
              <span className="font-semibold text-gray-800 dark:text-gray-200">{label}</span>
              <span className="block text-gray-600 dark:text-gray-400">{why}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        This links an <strong>existing</strong> Axal advisor account — it does not send an
        invitation. An address that is not an advisor is refused, because the grant would
        do nothing: every read re-checks the role, so an advisor who later stops being one
        loses access on their next attempt without you doing anything.
      </p>
      {note && <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">{note}</p>}

      <div className="mt-3">
        {state.loading && <p className="text-xs text-gray-500">Loading…</p>}
        {state.error && <p className="text-xs text-gray-700 dark:text-gray-300">{state.error}</p>}
        {!state.loading && !state.error && !state.items.length && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Not shared with any advisor yet.</p>
        )}
        {state.items.map((g) => (
          <div key={g.uid} className="flex items-start gap-3 border-t border-gray-100 py-2 dark:border-gray-800">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-gray-900 dark:text-gray-100">{g.advisor_email}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {g.status === 'active' ? 'Can see: ' : 'Access revoked · '}
                {g.status === 'active' && (
                  [g.scope_project && 'their record', g.scope_data_room && 'open data-room files',
                    g.scope_sessions && 'your other advisory sessions'].filter(Boolean).join(', ')
                  || 'nothing — every scope is off'
                )}
              </div>
              {g.status === 'active' && !g.advisor_is_advisor && (
                <div className="text-[11px] text-amber-700 dark:text-amber-500">
                  This account is no longer an advisor, so the grant reads nothing.
                </div>
              )}
            </div>
            {g.status === 'active' && (
              <button
                type="button" disabled={busy} onClick={() => revoke(g.uid)}
                className="text-xs font-semibold text-gray-600 underline disabled:opacity-50 dark:text-gray-300"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      <DocumentShares projectUid={projectUid} grants={state.items} busyOuter={busy} />
      <ReceivedWorkProducts />
    </section>
  );
}

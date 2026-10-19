import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded, Unreadable } from '../../ui';
import { useAuth } from '../../hooks/useAuthSync';
import { branchOfUser, isSuperAdminUser } from '../../lib/shellRole';
import { adminMercuryApi } from '../../lib/api/adminMercury';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { Banner, Group, Row, Sheet } from './ConnectorSheet';
import { agoLabel } from './connectorsModel';
import {
  ADMIN_ONLY, BRANCH_MANAGED, DISCONNECT_REASON_MIN, ENTITY_AUDIT_FOOT, ENTITY_DISCONNECT_NOTE, ENTITY_FEEDS, MEMBER_GROUPS, OPEN_BANKING,
  READS_ROW, TOKEN_HELP, USE_DOORS, confirmReadOnlyLabel, entityRows, landsWords, neverRows, retryAfterSentence, usesRows,
} from './mercuryModel';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal';

/**
 * D715 (#1780) PR 2a — the four Axal entity connections to Mercury (D710,
 * #1775), opened from the `mercury` row whose `connection_source` is
 * `mercury_entity_connections`. The Worker serves that row to an admin on HQ
 * only, and decides every act; this sheet only chooses what to draw.
 *
 * NO CANVAS COVERS IT YET. It is drawn only from the Connectors sheet's parts
 * (`Sheet`, `Group`, `Row`, `Banner`) and the Account center's buttons and
 * fields, with the words in `mercuryModel.js`. The canvas PR lays it out.
 *
 * ONE READ, ON OPEN. `GET /api/admin/mercury/connections` writes an audit row
 * before it answers, so it is called when the sheet opens and after an act,
 * never on a visit to Connectors. A branch admin's sheet makes no read.
 *
 * WHO SEES WHAT (decision 5). `superAdmin` draws Connect, Replace, Disconnect
 * and the token preview; any other admin gets Sync now and one sentence, with
 * no write control at all and no preview even if a response carries one.
 *
 * Bank text (organization names, nicknames) is drawn as text, never as HTML.
 * Nothing here draws a balance, a transaction or a Mercury account id.
 */

/** The Worker's own sentence for a refusal, with Sync now's wait added for a 429. */
function refusalText(e, fallback) {
  const msg = typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : fallback;
  if (e?.status === 429 || e?.code === 'sync_rate_limited') {
    const wait = retryAfterSentence(e?.data?.retry_after_seconds);
    return wait ? `${msg} ${wait}` : msg;
  }
  return msg;
}

/** One entity's connect or replace form (decision 6). The token is cleared after every answer. */
function ConnectForm({ row, replacing, docsUrl, api, onDone, onCancel }) {
  const [token, setToken] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (ev) => {
    ev.preventDefault();
    if (!confirmed || !token.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await api.connect(row.key, token.trim());
      setToken('');
      onDone();
    } catch (e) {
      setToken('');
      setError(refusalText(e, `${row.name}'s Mercury could not be connected.`));
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-3 py-3" data-testid={`mercury-connect-form-${row.key}`}>
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`mercury-connect-error-${row.key}`}>{error}</p>}
      <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Read Only token
        <input type="password" autoComplete="off" spellCheck={false} className={`${INPUT} mt-1`} value={token}
          onChange={(e) => setToken(e.target.value)} disabled={busy} data-testid={`mercury-token-${row.key}`} />
      </label>
      <label className="flex items-start gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
        <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} required
          data-testid={`mercury-confirm-${row.key}`} />
        <span>{confirmReadOnlyLabel(row.name)}</span>
      </label>
      {docsUrl && <a className={`${BTN.link} self-start`} href={docsUrl} target="_blank" rel="noreferrer" data-testid="mercury-token-help">{TOKEN_HELP}</a>}
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN.ghost} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className={BTN.primary} disabled={busy || !confirmed || !token.trim()} data-testid={`mercury-connect-submit-${row.key}`}>
          {busy ? 'Connecting…' : replacing ? 'Replace' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

/** One entity's disconnect form (decision 7): a reason of at least ten characters. */
function DisconnectForm({ row, api, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = reason.trim().length >= DISCONNECT_REASON_MIN;
  const submit = async (ev) => {
    ev.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      await api.disconnect(row.key, reason.trim());
      onDone();
    } catch (e) {
      setError(refusalText(e, `${row.name}'s Mercury could not be disconnected.`));
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 px-3 py-3" data-testid={`mercury-disconnect-form-${row.key}`}>
      <p className="text-[12px] text-axal-muted dark:text-gray-400">{ENTITY_DISCONNECT_NOTE}</p>
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`mercury-disconnect-error-${row.key}`}>{error}</p>}
      <label className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">Reason
        <input type="text" className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}
          placeholder={`At least ${DISCONNECT_REASON_MIN} characters`} data-testid={`mercury-disconnect-reason-${row.key}`} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN.ghost} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className={BTN.danger} disabled={busy || !ready} data-testid={`mercury-disconnect-submit-${row.key}`}>
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
    </form>
  );
}

/** One entity's group: its state, organization, accounts, last sync and error, and the acts this viewer may take. */
function EntityGroup({ row, superAdmin, docsUrl, api, onChanged }) {
  const [form, setForm] = useState(null); // 'connect' | 'disconnect' | null
  const [sync, setSync] = useState({ busy: false, note: '', tone: 'neutral' });
  const live = row.connected;
  const runSync = async () => {
    setSync({ busy: true, note: '', tone: 'neutral' });
    try {
      await api.sync(row.key);
      setSync({ busy: false, note: '', tone: 'neutral' });
      onChanged();
    } catch (e) {
      setSync({ busy: false, note: refusalText(e, 'The sync could not start.'), tone: 'danger' });
    }
  };
  const acts = (
    <>
      {live && <button type="button" className={BTN.ghost} disabled={sync.busy} onClick={runSync} data-testid={`mercury-sync-${row.key}`}>{sync.busy ? 'Syncing…' : 'Sync now'}</button>}
      {superAdmin && !live && <button type="button" className={BTN.primary} onClick={() => setForm('connect')} data-testid={`mercury-connect-${row.key}`}>Connect</button>}
      {superAdmin && live && <button type="button" className={BTN.ghost} onClick={() => setForm('connect')} data-testid={`mercury-replace-${row.key}`}>Replace</button>}
      {superAdmin && live && <button type="button" className={BTN.ghost} onClick={() => setForm('disconnect')} data-testid={`mercury-disconnect-${row.key}`}>Disconnect</button>}
    </>
  );
  const done = () => { setForm(null); onChanged(); };
  return (
    <div data-testid={`mercury-entity-${row.key}`}>
      <Group label={row.name}>
        <Row a="State" pill={<Pill tone={row.state.tone || 'neutral'}>{row.state.text}</Pill>} b={row.state.reason || undefined} />
        {row.connected || row.orgName ? (
          <Row a="Organization" b={row.orgName ?? <Unrecorded reason="Mercury reported no organization name.">Not recorded</Unrecorded>} />
        ) : null}
        {row.orgNameDiffers && <Row a="Matched by account endings" b={row.orgNameDiffers} />}
        {row.accounts === null
          ? (row.connected && <Row a="Accounts" b={<Unrecorded reason="The connections read carried no accounts.">Not recorded</Unrecorded>} />)
          : row.accounts.length === 0
            ? <Row a="Accounts" b="Mercury listed no account." />
            : row.accounts.map((acc, i) => (
              <Row key={`${acc.text}-${i}`} a={acc.text} b={[acc.nickname, acc.note].filter(Boolean).join(' · ') || undefined} />
            ))}
        {row.connected && <Row a="Last sync" b={row.lastSyncedAt ? agoLabel(row.lastSyncedAt) : <Unrecorded reason="No sync has run.">Not recorded</Unrecorded>} />}
        {row.error && <Row a="Last sync failed" b={row.error} tone="danger" />}
        {/* Decision 5: the preview is the Super Admin's only. */}
        {superAdmin && row.tokenPreview && <Row a="Token" b={row.tokenPreview} />}
        {row.note && <Row a="The Fund" b={row.note} />}
        {(live || superAdmin) && <Row a={<span className="sr-only">Actions</span>} action={acts} />}
        {sync.note && <Row a="Sync now" b={sync.note} tone={sync.tone} />}
        {superAdmin && form === 'connect' && (
          <ConnectForm row={row} replacing={live} docsUrl={docsUrl} api={api} onDone={done} onCancel={() => setForm(null)} />
        )}
        {superAdmin && form === 'disconnect' && live && (
          <DisconnectForm row={row} api={api} onDone={done} onCancel={() => setForm(null)} />
        )}
      </Group>
    </div>
  );
}

/**
 * The four entity rows with their acts (decisions 4 to 7). #1779's Banking tab
 * draws this rather than a second copy of these controls. It makes the one
 * audited read when it mounts, and again after an act; a branch admin's makes none.
 */
export function MercuryEntityConnections({ superAdmin = false, branch = null, api = adminMercuryApi, docsUrl = null }) {
  const [read, setRead] = useState({ status: branch ? 'branch' : 'loading', rows: [] });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(() => {
    if (branch) return;
    setRead((r) => ({ ...r, status: r.rows.length ? 'ready' : 'loading' }));
    api.connections().then(
      (r) => { if (alive.current) setRead({ status: 'ready', rows: entityRows(r).filter(Boolean) }); },
      () => { if (alive.current) setRead({ status: 'unreadable', rows: [] }); },
    );
  }, [api, branch]);
  useEffect(() => { load(); }, [load]);

  if (branch) return <Banner tone="neutral" data-testid="mercury-branch">{BRANCH_MANAGED}</Banner>;
  if (read.status === 'loading') return <div className="mx-5 mt-4"><LoadingRows lines={4} /></div>;
  if (read.status === 'unreadable') {
    return (
      <div className="mx-5 mt-4" data-testid="mercury-unreadable">
        <Unreadable what="The entity connections" claim="This is not a claim that none is connected." onRetry={load} />
      </div>
    );
  }
  return (
    <div data-testid="mercury-entities">
      {!superAdmin && <Banner tone="neutral" data-testid="mercury-admin-only">{ADMIN_ONLY}</Banner>}
      {read.rows.map((row) => (
        <EntityGroup key={row.key} row={row} superAdmin={superAdmin} docsUrl={docsUrl} api={api} onChanged={load} />
      ))}
    </div>
  );
}

/** The entity sheet: the rows, what they feed, and the audit note at its foot. */
export function MercuryEntitySheet({ p, superAdmin = false, branch = null, api = adminMercuryApi, onClose, eyebrow = 'Fund administration' }) {
  const name = p?.display_name || 'Mercury';
  return (
    <Sheet eyebrow={eyebrow} title={`${name} · Axal entities`} provider={p?.key || 'mercury'} providerName={name}
      sub="The four Axal entities' Mercury organizations." onClose={onClose} data-testid="mercury-entity-sheet"
      footer={<span className="mr-auto text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="mercury-audit-foot">{ENTITY_AUDIT_FOOT}</span>}>
      <MercuryEntityConnections superAdmin={superAdmin} branch={branch} api={api} docsUrl={p?.docs_url || null} />
      {!branch && <p className="mx-5 mt-4 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="mercury-feeds">{ENTITY_FEEDS}</p>}
      {/* #1780 decision 12: the door to fund administration's Banking tab (D714 PR 4a mounts it). */}
      {!branch && <Link className={`${BTN.link} mx-5 mt-2 inline-block`} to={OPEN_BANKING.href} data-testid="mercury-open-banking">{OPEN_BANKING.text}</Link>}
    </Sheet>
  );
}

/**
 * D753 (#1991, F5) — the entity row on its own page, `/account/connectors/mercury`:
 * the sheet's body in the page's flow, with no frame, no × and no header
 * action. Its one audited read happens when the page mounts it; a branch
 * admin's makes none. The viewer's flags come from the session, as the
 * panel's do; `api` is for a test.
 */
export function MercuryEntityPageBody({ p, api = adminMercuryApi }) {
  const user = useAuth()?.user ?? null;
  const branch = branchOfUser(user);
  return (
    <section data-testid="mercury-entity-page" aria-label="Axal entities" className="flex min-w-0 flex-col rounded-axal-sm border border-axal-hairline bg-white pb-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="px-5 pt-4">
        <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Axal entities</h2>
        <p className="mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">The four Axal entities&rsquo; Mercury organizations.</p>
      </div>
      <MercuryEntityConnections superAdmin={isSuperAdminUser(user)} branch={branch} api={api} docsUrl={p?.docs_url || null} />
      {!branch && <p className="mx-5 mt-4 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="mercury-feeds">{ENTITY_FEEDS}</p>}
      {!branch && <Link className={`${BTN.link} mx-5 mt-2 self-start`} to={OPEN_BANKING.href} data-testid="mercury-open-banking">{OPEN_BANKING.text}</Link>}
      {/* A branch admin's page reads nothing, so it records nothing. */}
      {!branch && <p className="mx-5 mt-4 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="mercury-audit-foot">{ENTITY_AUDIT_FOOT}</p>}
    </section>
  );
}

/** The sheet as `ConnectorPanel` opens it (Build's lightbox): the viewer's flags from the session, the real API. */
export function MercuryEntityPanel({ p, onClose, eyebrow }) {
  const user = useAuth()?.user ?? null;
  return (
    <MercuryEntitySheet p={p} superAdmin={isSuperAdminUser(user)} branch={branchOfUser(user)} api={adminMercuryApi}
      onClose={onClose} eyebrow={eyebrow} />
  );
}

// ── A member's own Mercury (D715 PR 3, decision 8) ────────────────────────────
//
// `ConnectorPanel` draws these for the personal row (`isPersonalMercury`) in
// its `pre`, `pro` and `detail` views, in place of what a syncing connector
// shows: what it pulls in and sends out, the companies it serves, and Sync.
// No canvas covers them yet; they use the sheet's own `Group` and `Row`.

/**
 * "What StudioOS uses it for" and "What it never does" (PR 3b). The uses come
 * from one `GET /api/mercury/personal/status` when the group mounts: a row per
 * use the caller's profile holds, in decision 8's words. With none left it
 * reads Not recorded with its reason; a failed read is Unreadable, and the
 * never rows still draw, in the viewer's role's words (`neverRows(role)`,
 * D752). Each row links the screen where that use happens (`USE_DOORS`,
 * #1780's canvas PR, on #1778's screens); a use with no screen has no door.
 */
export function MercuryUsesGroups({ api = mercuryPersonalApi, role = null }) {
  const [read, setRead] = useState({ status: 'loading', uses: null });
  const load = useCallback(() => {
    let live = true;
    setRead({ status: 'loading', uses: null });
    api.status().then(
      (r) => { if (live) setRead({ status: 'ready', uses: usesRows(r) }); },
      () => { if (live) setRead({ status: 'unreadable', uses: null }); },
    );
    return () => { live = false; };
  }, [api]);
  useEffect(() => load(), [load]);
  return (
    <>
      <Group label={MEMBER_GROUPS.uses}>
        {read.status === 'loading' && <div className="px-3 py-2"><LoadingRows lines={2} /></div>}
        {read.status === 'unreadable' && (
          <div className="px-3 py-2" data-testid="mercury-uses-unreadable">
            <Unreadable what="Which uses your profile allows" claim="This is not a claim that it allows none." onRetry={load} />
          </div>
        )}
        {read.status === 'ready' && (read.uses.rows.length
          ? read.uses.rows.map((u) => {
            const door = Object.hasOwn(USE_DOORS, u.key) ? USE_DOORS[u.key] : null;
            return <Row key={u.key} a={u.text} action={door ? <Link className={BTN.link} to={door.href} data-testid={`mercury-door-${u.key}`}>{door.text}</Link> : null} />;
          })
          : <Row a={<Unrecorded reason={read.uses.reason}>Not recorded</Unrecorded>} />)}
      </Group>
      <Group label={MEMBER_GROUPS.never}>
        {neverRows(role).map((t) => <Row key={t} a={t} />)}
      </Group>
    </>
  );
}

/** "Where it lands", in the viewer's role's words; in place of the company ticks, which gate nothing for Mercury. */
export function MercuryLandsGroup({ role }) {
  const words = landsWords(role);
  return (
    <Group label={MEMBER_GROUPS.lands}>
      <Row a={words || <Unrecorded reason="Your profile has no Mercury of its own.">Not recorded</Unrecorded>} />
    </Group>
  );
}

/** "How it reads", in place of the Sync group: a member's Mercury never syncs, so there is no Sync now. */
export function MercuryReadsGroup() {
  return (
    <Group label={MEMBER_GROUPS.reads}>
      <Row a={READS_ROW} />
    </Group>
  );
}

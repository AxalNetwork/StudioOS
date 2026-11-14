/**
 * D5060 (#5060, part 3) — one user licence (Founder, Investor, Operating Partner or Advisor), at
 * `/admin/licences/registry/user/:uid`: the Licences and Contracts v2 addendum's boards L37 and L37B. It reads the registry
 * detail (`/api/admin/licence-registry/:uid`, `layout: 'user'`) and draws the user licence's own sections:
 *
 *   Overview · Programs · Agreement · Billing · History
 *
 * The territory licence's tabs (Terms, Access, Operations) are not reused. Billing is drawn only when the licence
 * has commercial terms; with none it is left out, not drawn empty (L37B). Programs reuses D5059's table; its grant
 * changes stay on Program access. Each agreement opens the same canonical record in Contracts (D5060 §4).
 * An operator licence's uid here goes to its own page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { licenceRegistryApi } from '../../../lib/api/licenceRegistry';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, Unreadable } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { ProgramsTable } from '../grants/EntitlementViews';
import {
  agreementCell, agreementVersions, attentionCell, contractsHref, dateWord, heldBy, historyLine, missing, relatedName,
  renewalCell, sectionFromParam, statusWord, userSections,
} from '../licenceRegistryModel';

const CARD = 'rounded-xl border border-gray-200 bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100';
const SUB = 'text-[12px] leading-[1.45] text-gray-500 dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-gray-900 dark:text-gray-100';
const LINK = 'font-semibold text-indigo-700 hover:underline dark:text-indigo-300';

function Fact({ k, children, testId }) {
  return (
    <>
      <dt className="text-[12px] font-bold text-gray-500 dark:text-gray-400">{k}</dt>
      <dd className="m-0 text-[13.5px] text-gray-900 dark:text-gray-100" data-testid={testId}>{children}</dd>
    </>
  );
}

/** A section the Worker could not give: Not recorded with its reason, or Unreadable. Never drawn as none. */
function Gone({ sec, testId }) {
  const g = missing(sec);
  if (!g) return null;
  return (
    <p className={g.state === 'unreadable' ? 'text-[13px] font-semibold text-red-700 dark:text-red-300' : `${SUB} italic`} data-state={g.state} data-testid={testId}>
      {g.state === 'unreadable' ? `! ${g.reason || 'Unreadable.'}` : `Not recorded. ${g.reason || ''}`.trim()}
    </p>
  );
}

function Overview({ d }) {
  const o = d.overview;
  const account = o.account;
  const ent = o.entitlements;
  const inForce = ent && ent.available !== false ? (ent.items || []).filter((p) => p.in_force).map((p) => p.program_name) : null;
  const renewal = renewalCell(o);
  const attention = attentionCell(o);
  return (
    <section className={CARD} data-testid="user-licence-overview">
      <h2 className={H2}>Overview</h2>
      <dl className="mt-2 grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <Fact k="Holder">{o.holder?.name || 'Not recorded'}</Fact>
        <Fact k="Type">{o.licence_type_label}</Fact>
        <Fact k="Status" testId="user-licence-status">{statusWord(o.status)}{o.starts_on ? ` since ${dateWord(o.starts_on)}` : ''}</Fact>
        <Fact k="Renewal">{renewal.state === 'value' ? renewal.label : <span className="italic text-gray-500" title={renewal.reason || undefined}>Not recorded</span>}</Fact>
        <Fact k="Account" testId="user-licence-account">
          {account?.available === false
            ? <Gone sec={account} testId="user-licence-account-missing" />
            : <>{account?.name || account?.email || `Account ${account?.user_id}`}{account?.email && account?.name ? ` · ${account.email}` : ''} · {account?.is_active ? 'active' : 'inactive'}</>}
        </Fact>
        <Fact k="Key entitlements" testId="user-licence-entitlements">
          {inForce === null ? <Gone sec={ent} testId="user-licence-entitlements-missing" /> : inForce.length ? inForce.join(' · ') : 'None in force'}
        </Fact>
        <Fact k="Attention" testId="user-licence-attention">
          {attention.items ? attention.items.map((a) => a.label).join(' · ') : 'None'}
        </Fact>
      </dl>
    </section>
  );
}

function Programs({ d }) {
  const p = d.programs;
  const uid = d.overview.uid;
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="user-licence-programs-card">
      <h2 className={H2}>Programs</h2>
      <p className={SUB}>Eligible is this licence type’s rule; granted is HQ’s; in force also needs a valid licence and any agreement the program requires.</p>
      {p?.available === false
        ? <Gone sec={p} testId="user-licence-programs-missing" />
        : <ProgramsTable rows={p?.items || []} thisUid={uid} testId="user-licence-programs" />}
      <p className={SUB}>
        Grants are changed on <Link className={LINK} to={`/admin/licences/programs/licence/${encodeURIComponent(uid)}`} data-testid="user-licence-manage-grants">Program access for this licence</Link>.
      </p>
    </section>
  );
}

function AgreementRow({ title, kind, legal, effective, uid, testId }) {
  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid={testId}>
      <td className={`${TD} font-semibold`}>{title}</td>
      <td className={`${TD} text-[12px] text-gray-500 dark:text-gray-400`}>{kind}</td>
      <td className={TD}>{legal}</td>
      <td className={`${TD} font-mono text-[12px]`}>{effective || 'Not signed'}</td>
      <td className={TD}>{uid ? <Link className={LINK} to={contractsHref(uid)} data-testid="user-licence-open-contract">Open in Contracts ›</Link> : null}</td>
    </tr>
  );
}

function Agreement({ d }) {
  const a = d.agreement || {};
  const primary = agreementCell(a.primary);
  const versions = a.versions?.available === false ? null : agreementVersions(a.versions);
  const related = a.related?.available === false ? null : (a.related?.items || []);
  const title = `${d.overview.licence_type_label} Licence Agreement`;
  const rows = [];
  if (versions) {
    versions.forEach((v, i) => rows.push(
      <AgreementRow
        key={v.agreement_uid} title={`${title}${v.template_version ? ` · v${v.template_version}` : ''}`}
        kind={i === 0 && v.is_current !== false ? 'user licence · primary' : 'user licence · amendment / history'}
        legal={v.legal_status_label || statusWord(v.legal_status)} effective={dateWord(v.signed_at)} uid={v.agreement_uid}
        testId="user-licence-agreement-version"
      />,
    ));
  }
  if (related) {
    related.forEach((r) => rows.push(
      <AgreementRow
        key={r.agreement_uid} title={relatedName(r)} kind="program · related"
        legal={r.legal_status_label || statusWord(r.legal_status)} effective={dateWord(r.signed_at)} uid={r.envelope_uuid}
        testId="user-licence-agreement-related"
      />,
    ));
  }
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="user-licence-agreement">
      <h2 className={H2}>Agreement</h2>
      <p className={SUB} data-testid="user-licence-agreement-primary" data-state={primary.state}>
        Primary: {primary.state === 'unreadable' ? `! ${primary.label}` : primary.label}{primary.reason ? ` · ${primary.reason}` : ''}
      </p>
      <Gone sec={a.versions} testId="user-licence-versions-missing" />
      <Gone sec={a.related} testId="user-licence-related-missing" />
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">
              {['Agreement', 'Type', 'Status', 'Effective', ''].map((h) => <th key={h || 'open'} className={TH}>{h}</th>)}
            </tr></thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (versions && related ? <p className={SUB} data-testid="user-licence-agreement-none">No agreement has been sent for this licence. An Admin sends one from Contracts.</p> : null)}
    </section>
  );
}

function History({ d }) {
  const h = d.history;
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="user-licence-history">
      <h2 className={H2}>History</h2>
      {h?.available === false ? <Gone sec={h} testId="user-licence-history-missing" />
        : !(h?.items || []).length ? <p className={SUB} data-testid="user-licence-history-none">No lifecycle event is recorded for this licence.</p>
          : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {h.items.map((e) => {
                const l = historyLine(e);
                return (
                  <li key={e.id} className="border-b border-gray-100 pb-2 last:border-0 dark:border-gray-800" data-testid="user-licence-event">
                    <span className="font-mono text-[12px] text-gray-500 dark:text-gray-400">{l.when} · revision {l.revision}</span>
                    <p className="m-0 text-[13px] text-gray-900 dark:text-gray-100"><b>{l.action}</b> · {l.move}</p>
                    {l.reason ? <p className={`${SUB} m-0`}>{l.reason}</p> : null}
                  </li>
                );
              })}
            </ol>
          )}
    </section>
  );
}

function Billing({ d }) {
  // Drawn only when the read has commercial terms (`userSections`); none are recorded on a user licence today, so
  // each recorded term is listed by its name rather than laid out for fields no store holds yet.
  const terms = Object.entries(d.billing || {}).filter(([k, v]) => k !== 'available' && v !== null && typeof v !== 'object');
  return (
    <section className={CARD} data-testid="user-licence-billing">
      <h2 className={H2}>Billing</h2>
      <dl className="mt-2 grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {terms.map(([k, v]) => <Fact key={k} k={statusWord(k)}>{String(v)}</Fact>)}
      </dl>
    </section>
  );
}

const SECTION = { overview: Overview, programs: Programs, agreement: Agreement, billing: Billing, history: History };

function useDetail(uid) {
  const [read, setRead] = useState({ state: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ state: 'loading', data: null });
    licenceRegistryApi.detail(uid).then(
      (data) => { if (live) setRead({ state: 'ready', data }); },
      (e) => {
        if (e?.status !== 404) reportError('licence-registry:detail', e);
        if (live) setRead({ state: e?.status === 404 ? 'missing' : 'error', data: null });
      },
    );
    return () => { live = false; };
  }, [uid, tick]);
  return [read, useCallback(() => setTick((t) => t + 1), [])];
}

export function UserLicenceView({ uid }) {
  const [read, retry] = useDetail(uid);
  const [params, setParams] = useSearchParams();
  const d = read.data;
  const o = d?.overview;
  const header = (
    <AdminPageHeader
      crumb={{ label: 'Licences', to: '/admin/licences?family=all', current: o?.licence_ref || uid }}
      title={o ? `${o.holder?.name || 'Holder not recorded'} · ${o.licence_type_label} licence` : 'User licence'}
      pills={[{ label: 'HQ only', tone: 'hq' }]}
      line={o ? `${o.licence_ref} · user licence · ${heldBy(o)} · ${statusWord(o.status)}` : 'One user licence: its programs, agreement and history.'}
      data-testid="user-licence-header"
    />
  );
  if (read.state === 'missing') return <div className="flex flex-col gap-4">{header}<p className={SUB} data-testid="user-licence-missing">There is no licence with that id.</p></div>;
  if (read.state === 'error') return <div className="flex flex-col gap-4">{header}<Unreadable what="This licence" claim="This is not a claim that the licence does not exist." onRetry={retry} /></div>;
  if (!d) return <div className="flex flex-col gap-4">{header}<p className={SUB}>Reading…</p></div>;
  if (d.available === false) return <div className="flex flex-col gap-4">{header}<Gone sec={d} testId="user-licence-not-recorded" /></div>;
  if (d.layout === 'operator') return <Navigate to={`/admin/licences/${encodeURIComponent(uid)}`} replace />;
  const sections = userSections(d);
  const current = sectionFromParam(d, params.get('section'));
  const Section = SECTION[current];
  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-10" data-testid="user-licence-detail">
      {header}
      <nav aria-label="Licence sections" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800" data-testid="user-licence-sections">
        {sections.map((s) => (
          <button
            key={s.key} type="button" aria-current={s.key === current ? 'page' : undefined}
            onClick={() => setParams((prev) => { const n = new URLSearchParams(prev); if (s.key === 'overview') n.delete('section'); else n.set('section', s.key); return n; })}
            data-testid={`user-licence-section-${s.key}`}
            className={`-mb-px min-h-[36px] border-b-2 px-3 text-[13px] font-semibold ${s.key === current
              ? 'border-indigo-600 text-indigo-800 dark:border-indigo-400 dark:text-indigo-200'
              : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <Section d={d} />
    </div>
  );
}

export default function UserLicenceDetail() {
  const { uid } = useParams();
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads this licence. It changes nothing." data-testid="admin-board-user-licence-detail">
      <UserLicenceView key={uid} uid={uid} />
    </AdminBoardFrame>
  );
}

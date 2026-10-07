import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded } from '../../ui';
import { ROLES, rowsFor } from '../../lib/trustObligations';

/**
 * D633 (#1391, Q3) — HQ · Security → trust obligations by role, the Ops
 * canvas's `hq-obligations` (design/canvases/integrated/ops-data.js).
 *
 * Read-only. For each role (founder, investor, advisor, partner and admin),
 * what it must sign or prove, whether it is required, and how long it stays
 * valid before renewal, read from `GET /trust/matrix?role=` (services/trust.ts).
 * These are the defaults a new account is seeded with; one member's list can
 * differ, and the page says so. Nothing writes a sanctions review, so the
 * page offers none.
 *
 * Each role is read on its own: a role that cannot be read says "Unreadable"
 * with Try again, and the others stand.
 */

export function RoleCard({ role, read, onRetry }) {
  let body;
  if (!read || read.status === 'loading') body = <p role="status" className="py-3 text-[12.5px] text-axal-muted">Loading…</p>;
  else if (read.status === 'unreadable') {
    body = (
      <p role="alert" className="flex flex-wrap items-center gap-2 py-3 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`obligations-unreadable-${role.id}`}>
        <span><strong>Unreadable.</strong> The {role.label.toLowerCase()} obligations could not be read just now.</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={11} aria-hidden="true" /> Try again</button>
      </p>
    );
  } else {
    const rows = rowsFor(read.data?.obligations);
    body = rows.length === 0
      ? <p className="py-3 text-[12.5px] text-axal-muted" data-testid={`obligations-empty-${role.id}`}>This role carries no obligation.</p>
      : (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]" data-testid={`obligation-${role.id}-${r.key}`}>
              <span className="font-semibold">{r.title}</span>
              <span className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.required ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{r.required ? 'Required' : 'Optional'}</span>
                <span className="text-axal-muted">{r.validity.nr ? <Unrecorded reason={r.validity.reason} /> : r.validity.text}</span>
              </span>
            </li>
          ))}
        </ul>
      );
  }
  return (
    <Card className="p-4" data-testid={`obligations-role-${role.id}`}>
      <h2 className="text-[14px] font-bold">{role.label}</h2>
      {body}
    </Card>
  );
}

export default function TrustObligationsPage({ read = api.trustMatrix }) {
  const [reads, setReads] = useState({});
  const load = useCallback((roleId) => {
    setReads((r) => ({ ...r, [roleId]: { status: 'loading', data: null } }));
    read(roleId).then(
      (data) => setReads((r) => ({ ...r, [roleId]: { status: 'ready', data } })),
      (e) => { reportError('TrustObligations:read', e); setReads((r) => ({ ...r, [roleId]: { status: 'unreadable', data: null } })); },
    );
  }, [read]);
  useEffect(() => { ROLES.forEach((role) => load(role.id)); }, [load]);
  return (
    <div className="space-y-4" data-testid="trust-obligations-page">
      <header>
        <Link to="/admin/security" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:underline"><ArrowLeft size={12} aria-hidden="true" /> Security</Link>
        <div className="mt-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint"><ShieldCheck size={13} aria-hidden="true" /> HQ · Security</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Trust obligations by role</h1>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-axal-muted" data-testid="obligations-note">
          What each role must sign or prove, whether it is required, and how long it stays valid before renewal.
          Read-only. These are the defaults a new account starts with; one member&apos;s list can differ from them.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((role) => <RoleCard key={role.id} role={role} read={reads[role.id]} onRetry={() => load(role.id)} />)}
      </div>
    </div>
  );
}

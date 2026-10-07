import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { LegalPanel } from '../AdminPage';
import { Unrecorded, Unreadable, RailFrame, WorkerRail } from '../../ui';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';

export const UNAVAILABLE = Symbol('unavailable');

const LAYER_ORDER = ['gp', 'fund', 'portfolio', 'compliance'];

const PARTY_LABEL = {
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Partner',
  axal: 'Axal VC',
};

const LAYER_CODE_LABEL = {
  gp: 'GP',
  fund: 'FUND',
  portfolio: 'PORTFOLIO',
  compliance: 'COMPLIANCE',
};

function formatLastUsed(at) {
  if (at == null || at === '') return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

/**
 * Group registry rows by governance layer (Contracts · Super X1 — four code layers).
 */
export function groupDocTypesByLayer(items, layers) {
  const layerMeta = new Map((layers || []).map((l) => [l.id, l]));
  const buckets = new Map(LAYER_ORDER.map((id) => [id, []]));
  const outside = [];
  for (const row of items || []) {
    const id = row.layer || 'gp';
    if (buckets.has(id)) buckets.get(id).push(row);
    else outside.push(row);
  }
  const groups = LAYER_ORDER.filter((id) => (buckets.get(id) || []).length).map((id) => ({
    id,
    label: layerMeta.get(id)?.label || id,
    description: layerMeta.get(id)?.description || '',
    items: buckets.get(id) || [],
  }));
  if (outside.length) {
    groups.push({
      id: '_outside',
      label: 'Outside the four code layers',
      description: 'Counted in the header total — not dropped because the layer name does not match gp / fund / portfolio / compliance.',
      items: outside,
    });
  }
  return groups;
}

// D622 — the route's floor for a publish reason (`REGISTRY_PUBLISH_REASON_MIN`).
export const PUBLISH_REASON_MIN = 10;

/** Who saved a pending revision, and when, as one sentence. */
export function pendingSavedLine(pending) {
  const who = pending?.updated_by_name
    || (pending?.updated_by != null ? `Admin #${pending.updated_by}` : 'an admin whose account is not recorded');
  // `draft_updated_at` is SQLite's UTC 'YYYY-MM-DD HH:MM:SS.mmm'.
  const d = pending?.updated_at ? new Date(`${String(pending.updated_at).replace(' ', 'T')}Z`) : null;
  return d && !Number.isNaN(d.getTime())
    ? `Saved by ${who} on ${d.toLocaleString()}.`
    : `Saved by ${who}, at a time not recorded.`;
}

/** Live against pending, field by field, so a reviewer sees exactly what would go live. */
export function revisionRows(live, pending) {
  const roles = (v) => (v || []).map((r) => PARTY_LABEL[r] || r).join(', ') || '—';
  const fields = (v) => (v || []).join(', ') || '—';
  return [
    { id: 'title', label: 'Title', live: live.title || '—', pending: pending.title || '—' },
    { id: 'layer', label: 'Layer', live: LAYER_CODE_LABEL[live.layer] || live.layer || '—', pending: LAYER_CODE_LABEL[pending.layer] || pending.layer || '—' },
    { id: 'party_roles', label: 'Party roles', live: roles(live.party_roles), pending: roles(pending.party_roles) },
    { id: 'required_fields', label: 'Required fields', live: fields(live.required_fields), pending: fields(pending.required_fields) },
  ].map((r) => ({ ...r, changed: r.live !== r.pending }));
}

/** Each refusal of the publish route, as a sentence the reader can act on. */
export function publishRefusal(e) {
  const code = e?.code || e?.data?.code || '';
  if (code === 'reason_required') return `Write a reason of at least ${PUBLISH_REASON_MIN} characters; it is recorded in the audit.`;
  if (code === 'draft_changed') return 'Someone saved this revision again after you opened it. Nothing was published. The card now shows the newer copy; review it, then publish.';
  if (code === 'reviewed_draft_required') return 'The publish did not say which revision you reviewed, so nothing was published. Reload the card and try again.';
  if (code === 'step_up_required') return 'Your step-up has lapsed. Confirm with your authenticator, then publish again. Nothing was published.';
  if (code === 'not_found') return 'This type is no longer in the store, so there is nothing to publish.';
  return e?.message ? `The publish was refused: ${e.message}` : 'The publish could not be completed. Nothing was published.';
}

/**
 * D622 — a published type's pending revision: who saved it and when, live
 * against pending, and the publish control, which is a Super Admin's. The
 * publish names the revision shown here (`reviewed_draft_at`), so a save that
 * lands after this card was drawn is refused by the route, not put live.
 */
export function PendingRevision({ row, canPublish, onPublished, publishFn = api.adminContractRegistryPublish }) {
  const pending = row.pending_draft;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = revisionRows(row, pending);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await publishFn(row.doc_type, { reason: reason.trim(), reviewed_draft_at: pending.updated_at });
      setReason('');
      if (onPublished) onPublished();
    } catch (e) {
      setError(publishRefusal(e));
      // A newer save: read the hub again so the card shows what would now go live.
      if ((e?.code || e?.data?.code) === 'draft_changed' && onPublished) onPublished();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/60 p-2 dark:border-violet-800 dark:bg-violet-950/30" data-testid={`registry-pending-${row.doc_type}`}>
      <p className="text-[10px] font-extrabold uppercase tracking-[.08em] text-violet-900 dark:text-violet-200">Pending revision · not live</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-axal-muted dark:text-gray-300" data-testid="registry-pending-saved">{pendingSavedLine(pending)}</p>
      <table className="mt-1.5 w-full text-left text-[10px]" data-testid="registry-pending-compare">
        <thead>
          <tr className="text-axal-faint">
            <th className="py-0.5 pr-2 font-bold" scope="col"><span className="sr-only">Field</span></th>
            <th className="py-0.5 pr-2 font-bold" scope="col">Live</th>
            <th className="py-0.5 font-bold" scope="col">Pending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`registry-pending-row-${r.id}`} data-changed={r.changed ? 'true' : 'false'}>
              <th scope="row" className="py-0.5 pr-2 font-bold text-axal-ink dark:text-gray-100">{r.label}</th>
              <td className="py-0.5 pr-2 text-axal-muted dark:text-gray-300">{r.live}</td>
              <td className={`py-0.5 ${r.changed ? 'font-bold text-violet-900 dark:text-violet-200' : 'text-axal-muted dark:text-gray-300'}`}>{r.pending}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canPublish ? (
        <div className="mt-2" data-testid="registry-publish-control">
          <label className="block text-[10px] font-bold text-axal-ink dark:text-gray-100" htmlFor={`publish-reason-${row.doc_type}`}>
            Reason for publishing (at least {PUBLISH_REASON_MIN} characters, recorded in the audit)
          </label>
          <textarea
            id={`publish-reason-${row.doc_type}`}
            rows={2}
            className="mt-1 w-full rounded border border-axal-hairline px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || reason.trim().length < PUBLISH_REASON_MIN}
            onClick={submit}
            className="mt-1 rounded bg-[#881337] px-2.5 py-1 text-[10.5px] font-extrabold text-white disabled:opacity-50"
            data-testid={`registry-publish-${row.doc_type}`}
          >
            {busy ? 'Publishing…' : 'Publish this revision'}
          </button>
          {error ? <p className="mt-1 text-[10.5px] leading-relaxed text-red-700 dark:text-red-400" role="alert" data-testid="registry-publish-error">{error}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-axal-muted dark:text-gray-300" data-testid="registry-publish-waits">
          It goes live only when a Super Admin reviews and publishes it.
        </p>
      )}
    </div>
  );
}

function RegistryTypeCard({ row, canPublish, onPublished }) {
  return (
    <div
      className="rounded-lg border border-axal-hairline bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900"
      data-testid={`registry-card-${row.doc_type}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11.5px] font-bold leading-snug text-axal-ink dark:text-white">{row.title}</div>
          <div className="font-mono text-[9.5px] text-axal-faint">{row.doc_type}</div>
        </div>
        {row.overlap ? (
          <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wide text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            OVERLAP
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {(row.party_roles || []).map((r) => (
          <span
            key={r}
            className="rounded-full bg-axal-hairline px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-axal-ink dark:bg-gray-800 dark:text-gray-100"
          >
            {PARTY_LABEL[r] || r}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[9.5px] leading-relaxed text-axal-muted dark:text-gray-300">
        {typeof row.usage_count === 'number' ? `${row.usage_count} uses` : 'Uses unreadable'}
        {formatLastUsed(row.last_used_at) ? ` · last ${formatLastUsed(row.last_used_at)}` : ''}
        {row.registry_status === 'draft' ? ' · draft in store' : ''}
      </p>
      {row.registry_status === 'published' && row.pending_draft ? (
        <PendingRevision row={row} canPublish={canPublish} onPublished={onPublished} />
      ) : null}
    </div>
  );
}

/**
 * D480 — doc-type registry hub (X1 layer cards + table fallback).
 */
export function DocTypeRegistry({ data, onRetry, canPublish = false }) {
  const groups = useMemo(
    () => (data && data !== UNAVAILABLE && data.items ? groupDocTypesByLayer(data.items, data.layers) : []),
    [data],
  );

  if (data === null) {
    return <p className="text-[12.5px] text-axal-faint">Loading the doc-type registry…</p>;
  }
  if (data === UNAVAILABLE) {
    return (
      <Unreadable
        what="The doc-type registry"
        claim="This is not a claim that no contract types exist."
        onRetry={onRetry}
      />
    );
  }

  const decisions = data.decisions || {};
  const overlapItems = (data.items || []).filter((r) => r.overlap);

  return (
    <div className="space-y-4" data-testid="hq-doc-type-registry">
      <p className="text-[11.5px] leading-relaxed text-axal-muted">
        {data.type_count} registered types across the code layers, with usage from the four-source contract union
        (documents without migrated duplicates, e-sign, pairwise NDAs, partner deals). The D1 store holds drafts and
        published overrides; Publish is step-up gated and audited as <span className="font-mono text-[10px]">registry.type.publish</span>.
      </p>

      <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-[11px] leading-relaxed text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="font-bold">Owner decisions still open (D480)</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>
            Canvas layers ({(decisions.canvas_layers || []).join(', ')}) vs code layers ({(decisions.code_layers || []).join(', ')}):
            {' '}
            <span className="font-semibold">pending owner decision — not mapped in this build.</span>
          </li>
          <li>
            Whether the registry governs <span className="font-mono">services/esignOriginators.ts</span>:
            {' '}
            <span className="font-semibold">pending owner decision.</span>
          </li>
        </ul>
      </div>

      {data.health?.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="registry-health-tiles">
          {data.health.map((h) => (
            <div key={h.id} className="rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900">
              <div className="text-[8.5px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{h.label}</div>
              <div className="mt-1 text-xl font-extrabold tabular-nums text-axal-ink dark:text-white">{h.value}</div>
              <p className="mt-1 text-[10px] leading-relaxed text-axal-muted">{h.note}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4" data-testid="registry-layer-cards">
        {groups.filter((g) => g.id !== '_outside').map((g) => (
          <section key={g.id} className="rounded-xl border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="rounded bg-axal-hairline px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-axal-ink dark:bg-gray-800 dark:text-white">
                {LAYER_CODE_LABEL[g.id] || g.id}
              </span>
              <span className="text-[10px] font-bold tabular-nums text-axal-muted">{g.items.length} types</span>
            </div>
            {g.description ? (
              <p className="mb-2 text-[10px] leading-relaxed text-axal-faint">{g.description}</p>
            ) : null}
            <div className="grid gap-2">
              {g.items.map((row) => (
                <RegistryTypeCard key={row.doc_type} row={row} canPublish={canPublish} onPublished={onRetry} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {overlapItems.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-[12px] font-bold text-amber-950 dark:text-amber-100">Overlapping party roles in the same layer</p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
            {overlapItems.map((r) => r.title).join(' · ')} — compare before merging types in the store.
          </p>
        </div>
      ) : null}

      {groups.filter((g) => g.id === '_outside').map((g) => (
        <section key={g.id} className="rounded-xl border border-dashed border-axal-hairline p-3">
          <h3 className="text-[12px] font-extrabold">{g.label}</h3>
          <p className="text-[10px] text-axal-faint">{g.description}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{g.items.map((row) => <RegistryTypeCard key={row.doc_type} row={row} canPublish={canPublish} onPublished={onRetry} />)}</div>
        </section>
      ))}
    </div>
  );
}

const DRAFT_STEPS = ['Title & slug', 'Layer', 'Party roles', 'Required fields', 'Review'];

function RegistryEditorModal({ open, onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [docType, setDocType] = useState('');
  const [title, setTitle] = useState('');
  const [layer, setLayer] = useState('portfolio');
  const [partyRoles, setPartyRoles] = useState(['founder', 'axal']);
  const [requiredFields, setRequiredFields] = useState(['effective_date']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError('');
  }, [open]);

  if (!open) return null;

  const toggleRole = (role) => {
    setPartyRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await api.adminContractRegistrySaveDraft({
        doc_type: docType,
        title,
        layer,
        party_roles: partyRoles,
        required_fields: requiredFields,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e?.message || 'Draft could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="registry-editor-modal">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-axal-hairline bg-white p-4 shadow-xl dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Registry editor · X2</p>
            <h2 className="text-lg font-extrabold text-axal-ink dark:text-white">New doc type</h2>
          </div>
          <button type="button" className="text-sm text-axal-muted" onClick={onClose}>Close</button>
        </div>
        <p className="mt-1 text-[11px] text-axal-muted">Step {step + 1} of {DRAFT_STEPS.length}: {DRAFT_STEPS[step]}</p>

        {step === 0 ? (
          <div className="mt-3 space-y-2">
            <label className="block text-[11px] font-bold">Friendly title</label>
            <input className="w-full rounded-lg border border-axal-hairline px-3 py-2 text-sm dark:bg-gray-800" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label className="block text-[11px] font-bold">Slug (doc_type)</label>
            <input className="w-full rounded-lg border border-axal-hairline px-3 py-2 font-mono text-sm dark:bg-gray-800" value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="ip_assignment_agreement" />
          </div>
        ) : null}
        {step === 1 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {LAYER_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setLayer(id)}
                className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${layer === id ? 'border-axal-violet bg-axal-violet/10' : 'border-axal-hairline'}`}
              >
                {LAYER_CODE_LABEL[id]}
              </button>
            ))}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.keys(PARTY_LABEL).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => toggleRole(role)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${partyRoles.includes(role) ? 'bg-axal-violet text-white' : 'bg-axal-hairline text-axal-muted'}`}
              >
                {PARTY_LABEL[role]}
              </button>
            ))}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="mt-3">
            <label className="block text-[11px] font-bold">Required merge fields (one per line)</label>
            <textarea
              className="mt-1 w-full rounded-lg border border-axal-hairline px-3 py-2 font-mono text-xs dark:bg-gray-800"
              rows={5}
              value={requiredFields.join('\n')}
              onChange={(e) => setRequiredFields(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            />
          </div>
        ) : null}
        {step === 4 ? (
          <div className="mt-3 space-y-1 text-[11px] text-axal-muted">
            <p><span className="font-bold text-axal-ink dark:text-white">{title || '—'}</span> · <span className="font-mono">{docType || '—'}</span></p>
            <p>Layer: {layer} · Roles: {partyRoles.join(', ') || '—'}</p>
            <p>Publish later requires TOTP, step-up, and a typed reason (≥10 characters).</p>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-[11px] text-red-600">{error}</p> : null}

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" className="text-sm text-axal-muted" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
          {step < DRAFT_STEPS.length - 1 ? (
            <button type="button" className="rounded-lg bg-axal-violet px-3 py-2 text-sm font-bold text-white" onClick={() => setStep((s) => s + 1)}>Next</button>
          ) : (
            <button type="button" disabled={saving} className="rounded-lg bg-axal-violet px-3 py-2 text-sm font-bold text-white" onClick={saveDraft}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * HQ · Contracts — registry hub (D480) and master template library.
 */
export default function HqContractsPage() {
  const { user } = useAuth() || {};
  // D622 — the publish control is a Super Admin's: the route's gate is
  // `requireSuperAdminWriteBar`, so any other admin is told it waits for one.
  const canPublish = isSuperAdminUser(user);
  const [registry, setRegistry] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadRegistry = useCallback(() => {
    setRegistry(null);
    api.adminContractRegistryHub()
      .then(setRegistry, (e) => {
        reportError('hq-contracts-registry', e);
        setRegistry(UNAVAILABLE);
      });
  }, []);

  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  const coverage = registry && registry !== UNAVAILABLE && registry.coverage ? registry.coverage : [];
  const rail = (
    <WorkerRail
      workspace="Contracts"
      role="super_admin"
      stance="Registry + library"
      note="This rail summarises registered doc types and live contract counts from the union read. It does not send envelopes or publish types — publish is a separate step-up action audited as registry.type.publish."
      coverage={coverage}
      coverageNote={registry === UNAVAILABLE
        ? 'The registry could not be read — this is not a claim that no contract types exist.'
        : (registry === null ? 'Loading the registry…' : undefined)}
      unavailable={[
        ['Cross-tenant oversight', 'No contract row names the subsidiary it belongs to (U1).'],
        ['Canvas ↔ code layer map', 'PLATFORM / VENTURE / FUND / ENGAGEMENT vs gp / fund / portfolio / compliance — pending owner decision.'],
        ['e-sign originators', 'Whether this registry governs esignOriginators.ts — pending owner decision.'],
      ]}
      data-testid="hq-contracts-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="hq-contracts-page">
      <div className="space-y-5">
        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <FileText size={13} /> HQ · Contracts
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Contracts</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            The doc-type registry names what a contract may be; the template library below holds versioned bodies
            tenants instantiate. Cross-tenant oversight: <Unrecorded /> — no contract row names the subsidiary it
            belongs to (U1).
          </p>
        </header>

        <section className="rounded-xl border border-axal-hairline bg-white p-4 dark:bg-gray-900">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Doc-type registry</h2>
            <button
              type="button"
              className="rounded-lg bg-[#881337] px-3 py-1.5 text-[11px] font-extrabold text-white"
              data-testid="registry-new-doc-type"
              onClick={() => setEditorOpen(true)}
            >
              New doc type
            </button>
          </div>
          <DocTypeRegistry data={registry} onRetry={loadRegistry} canPublish={canPublish} />
        </section>

        <section>
          <h2 className="mb-2 text-[14.5px] font-extrabold tracking-tight">Master template library</h2>
          <LegalPanel />
        </section>
      </div>
      <RegistryEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} onSaved={loadRegistry} />
    </RailFrame>
  );
}

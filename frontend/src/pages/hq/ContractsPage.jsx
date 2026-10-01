import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { LegalPanel } from '../AdminPage';
import { Unrecorded, Unreadable } from '../../ui';

export const UNAVAILABLE = Symbol('unavailable');

const LAYER_ORDER = ['gp', 'fund', 'portfolio', 'compliance'];

const PARTY_LABEL = {
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Partner',
  axal: 'Axal VC',
};

/**
 * Group registry rows by governance layer for the canvas layout (H10 / Contracts).
 */
export function groupDocTypesByLayer(items, layers) {
  const layerMeta = new Map((layers || []).map((l) => [l.id, l]));
  const buckets = new Map(LAYER_ORDER.map((id) => [id, []]));
  for (const row of items || []) {
    const id = row.layer || 'gp';
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(row);
  }
  return LAYER_ORDER.filter((id) => (buckets.get(id) || []).length).map((id) => ({
    id,
    label: layerMeta.get(id)?.label || id,
    description: layerMeta.get(id)?.description || '',
    items: buckets.get(id) || [],
  }));
}

/**
 * D454 — read-only doc-type registry above the template library (code-defined, not D1).
 */
export function DocTypeRegistry({ data, onRetry }) {
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

  return (
    <div className="space-y-4" data-testid="hq-doc-type-registry">
      <p className="text-[11.5px] leading-relaxed text-axal-muted">
        {data.type_count} contract types are declared in code — layer, title and party roles — with usage counted
        from documents and e-sign envelopes. Adding a type still means editing the worker registry; this panel
        does not author new types.
      </p>
      {groups.map((g) => (
        <section key={g.id} className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
          <div className="mb-2">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink dark:text-white">{g.label}</h2>
            {g.description && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">{g.description}</p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-axal-hairline text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                  <th className="py-1.5 pr-3">Type</th>
                  <th className="py-1.5 pr-3">Parties</th>
                  <th className="py-1.5 pr-3 text-right">Uses</th>
                  <th className="py-1.5">Last used</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((row) => (
                  <tr key={row.doc_type} className="border-b border-axal-hairline/60">
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{row.title}</div>
                      <div className="font-mono text-[10px] text-axal-faint">{row.doc_type}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(row.party_roles || []).map((r) => (
                          <span
                            key={r}
                            className="rounded-full bg-axal-hairline px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-axal-muted"
                          >
                            {PARTY_LABEL[r] || r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{row.usage_count ?? 0}</td>
                    <td className="py-2 text-[11px] text-axal-faint tabular-nums">
                      {row.last_used_at ? new Date(row.last_used_at).toLocaleDateString() : 'Not yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * HQ · Contracts — doc-type registry (D454) and the master template library (Legal panel).
 */
export default function HqContractsPage() {
  const [registry, setRegistry] = useState(null);

  const loadRegistry = useCallback(() => {
    setRegistry(null);
    api.adminContractDocTypes()
      .then(setRegistry, (e) => {
        reportError('hq-contracts-doc-types', e);
        setRegistry(UNAVAILABLE);
      });
  }, []);

  useEffect(() => { loadRegistry(); }, [loadRegistry]);

  return (
    <div className="space-y-5" data-testid="hq-contracts-page">
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
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">Doc-type registry</h2>
          <span className="text-[11px] text-axal-faint">read-only · code-defined</span>
        </div>
        <DocTypeRegistry data={registry} onRetry={loadRegistry} />
      </section>

      <section>
        <h2 className="mb-2 text-[14.5px] font-extrabold tracking-tight">Master template library</h2>
        <LegalPanel />
      </section>
    </div>
  );
}

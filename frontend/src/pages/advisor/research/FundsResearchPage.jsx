import React, { useMemo, useState } from 'react';
import { Landmark, Wallet, User, Scale } from 'lucide-react';
import {
  FUND_TABS, FUND_TYPES, FUND_DIRECTORY, FUND_MANAGERS, FUNDRAISES,
  money, formatDay, formatRelativeDay,
} from '../../../data/advisor/research';
import {
  SubTabs, SearchInput, FilterChips, SlideOver, Section, Field, Badge,
  BulletList, EmptyState, Chip,
} from './kit';

// Funds — research fund directory. Distinct from the investor Funds operations
// surface (/funds); this is a browse/compare directory of external VC/PE funds,
// their partners, and recent fundraises. Sub-tabs: Fund Directory (search /
// filter / compare), Investors & Partners, Fundraises.

export default function FundsResearchPage() {
  const [tab, setTab] = useState('directory');
  return (
    <div className="space-y-5">
      <SubTabs tabs={FUND_TABS} value={tab} onChange={setTab} />
      {tab === 'directory' && <DirectoryView />}
      {tab === 'managers' && <ManagersView />}
      {tab === 'fundraises' && <FundraisesView />}
    </div>
  );
}

function DirectoryView() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [id, setId] = useState(null);
  const [compare, setCompare] = useState([]); // selected fund ids
  const [showCompare, setShowCompare] = useState(false);

  const typeFilters = [{ id: 'all', label: 'All' }, ...FUND_TYPES.map((t) => ({ id: t, label: t }))];

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return FUND_DIRECTORY.filter((f) => {
      if (type !== 'all' && f.type !== type) return false;
      if (!term) return true;
      return [f.name, f.firm, f.thesis, f.geography, f.stage, ...(f.sectors || [])]
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [q, type]);

  const sel = FUND_DIRECTORY.find((x) => x.id === id) || null;
  const selected = FUND_DIRECTORY.filter((f) => compare.includes(f.id));

  const toggleCompare = (fid) => {
    setCompare((prev) => (prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]));
  };

  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search funds, firms, thesis, geography…" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips options={typeFilters} value={type} onChange={setType} />
        {compare.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{compare.length} selected</span>
            <button
              onClick={() => setShowCompare(true)}
              disabled={compare.length < 2}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Scale size={13} /> Compare
            </button>
            <button onClick={() => setCompare([])} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Clear</button>
          </div>
        )}
      </div>
      {rows.length === 0 ? <EmptyState>No funds match your search.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((f) => {
            const checked = compare.includes(f.id);
            return (
              <div key={f.id} className={`rounded-xl border bg-white dark:bg-gray-900 p-4 transition-colors ${checked ? 'border-violet-400 dark:border-violet-500' : 'border-gray-200 dark:border-gray-800 hover:border-violet-300'}`}>
                <button onClick={() => setId(f.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                        <Landmark size={14} className="text-gray-400 flex-shrink-0" /> <span className="truncate">{f.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{f.firm} · {f.geography}</div>
                    </div>
                    <Badge>{f.signal}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Chip tone="violet">{money(f.fundSize)} fund</Chip>
                    <Chip>Vintage {f.vintage}</Chip>
                    <Chip>{f.type}</Chip>
                    <Chip>{money(f.dryPowder)} dry powder</Chip>
                  </div>
                </button>
                <label className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                  <input type="checkbox" checked={checked} onChange={() => toggleCompare(f.id)} className="rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500" />
                  Compare
                </label>
              </div>
            );
          })}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.firm} · ${sel.type}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.signal}</Badge>
            <Chip tone="violet">{money(sel.fundSize)} fund size</Chip>
            <Chip>Vintage {sel.vintage}</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.thesis}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stage">{sel.stage}</Field>
            <Field label="Geography">{sel.geography}</Field>
            <Field label="Dry powder">{money(sel.dryPowder)}</Field>
            <Field label="HQ">{sel.hq}</Field>
          </div>
          <Section title="Focus sectors">
            <div className="flex flex-wrap gap-1.5">{sel.sectors.map((s) => <Chip key={s} tone="violet">{s}</Chip>)}</div>
          </Section>
          <Section title="Notable investments">
            <div className="flex flex-wrap gap-1.5">{sel.notableInvestments.map((n) => <Chip key={n}>{n}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
      {showCompare && selected.length >= 2 && (
        <SlideOver open onClose={() => setShowCompare(false)} title="Fund comparison" subtitle={`${selected.length} funds`}>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                <CompareRow label="Fund" values={selected.map((f) => f.name)} bold />
                <CompareRow label="Firm" values={selected.map((f) => f.firm)} />
                <CompareRow label="Type" values={selected.map((f) => f.type)} />
                <CompareRow label="Fund size" values={selected.map((f) => money(f.fundSize))} />
                <CompareRow label="Vintage" values={selected.map((f) => String(f.vintage))} />
                <CompareRow label="Stage" values={selected.map((f) => f.stage)} />
                <CompareRow label="Geography" values={selected.map((f) => f.geography)} />
                <CompareRow label="Dry powder" values={selected.map((f) => money(f.dryPowder))} />
                <CompareRow label="Signal" values={selected.map((f) => f.signal)} />
                <CompareRow label="Sectors" values={selected.map((f) => f.sectors.join(', '))} />
              </tbody>
            </table>
          </div>
        </SlideOver>
      )}
    </div>
  );
}

function CompareRow({ label, values, bold }) {
  return (
    <tr>
      <td className="py-2.5 pr-3 align-top text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`py-2.5 px-3 align-top text-gray-700 dark:text-gray-300 ${bold ? 'font-semibold text-gray-900 dark:text-gray-100' : ''}`}>{v}</td>
      ))}
    </tr>
  );
}

function ManagersView() {
  const [q, setQ] = useState('');
  const [id, setId] = useState(null);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return FUND_MANAGERS;
    return FUND_MANAGERS.filter((m) => [m.name, m.firm, m.role, m.focus, m.location].some((v) => String(v).toLowerCase().includes(term)));
  }, [q]);
  const sel = FUND_MANAGERS.find((x) => x.id === id) || null;
  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Search partners, firms, focus…" />
      {rows.length === 0 ? <EmptyState>No investors match your search.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((m) => (
            <button key={m.id} onClick={() => setId(m.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors flex gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-violet-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{m.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.role} · {m.firm}</div>
                <div className="mt-2 flex flex-wrap gap-1"><Chip>{m.focus}</Chip></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.name} subtitle={`${sel.role} · ${sel.firm}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="violet">{sel.focus}</Chip>
            <Chip>{sel.location}</Chip>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{sel.bio}</p>
          <Section title="Notable deals">
            <div className="flex flex-wrap gap-1.5">{sel.notableDeals.map((d) => <Chip key={d}>{d}</Chip>)}</div>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

function FundraisesView() {
  const [id, setId] = useState(null);
  const rows = useMemo(() => FUNDRAISES.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), []);
  const sel = FUNDRAISES.find((x) => x.id === id) || null;
  return (
    <div className="space-y-2">
      {rows.map((f) => (
        <button key={f.id} onClick={() => setId(f.id)} className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center flex-shrink-0">
            <Wallet size={16} className="text-violet-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <Badge>{f.status}</Badge>
              <Badge>{f.type}</Badge>
              <span className="text-[11px] text-gray-400">{formatRelativeDay(f.date)}</span>
            </div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{f.firm} — {f.fund}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">{f.signal}</div>
          </div>
          <div className="text-right flex-shrink-0 hidden sm:block">
            <div className="font-semibold text-violet-600 dark:text-violet-300 tabular-nums">{money(f.raised)}</div>
            <div className="text-[11px] text-gray-400">of {money(f.target)}</div>
          </div>
        </button>
      ))}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={`${sel.firm} — ${sel.fund}`} subtitle={`${sel.type} · ${formatDay(sel.date)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.status}</Badge>
            <Chip tone="violet">{money(sel.raised)} raised</Chip>
            <Chip>Target {money(sel.target)}</Chip>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Stage">{sel.stage}</Field>
            <Field label="Geography">{sel.geography}</Field>
          </div>
          <Section title="Deployment signal">
            <p className="text-sm text-gray-700 dark:text-gray-300">{sel.signal}</p>
          </Section>
        </SlideOver>
      )}
    </div>
  );
}

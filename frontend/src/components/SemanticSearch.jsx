import React, { useState, useRef, useEffect } from 'react';
import { Search, Loader2, FileText, User as UserIcon, Briefcase, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const TYPE_FILTERS = [
  { key: '', label: 'All' },
  { key: 'project', label: 'Projects' },
  { key: 'partner', label: 'Partners' },
  { key: 'document', label: 'Documents' },
];

function iconForType(t) {
  if (t === 'project') return Briefcase;
  if (t === 'partner') return UserIcon;
  return FileText;
}

export default function SemanticSearch() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [warning, setWarning] = useState('');
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = q.trim();
    if (!term) { setHits([]); setLoading(false); setWarning(''); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.searchSemantic(term, type || undefined, 10);
        setHits(res.hits || []);
        setWarning(res.warning || '');
      } catch (e) {
        setHits([]); setWarning(e.message || 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q, type]);

  const showDropdown = open && q.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
        <Search size={16} className="text-gray-400 shrink-0" />
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search projects, partners, documents…"
          className="flex-1 outline-none text-sm bg-transparent"
        />
        {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
        {q && !loading && (
          <button onClick={() => { setQ(''); setHits([]); }} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 mt-2">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.key || 'all'}
            onClick={() => setType(f.key)}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${type === f.key ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showDropdown && (
        <div className="absolute z-30 left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-auto">
          {warning && <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">{warning}</div>}
          {!loading && hits.length === 0 && !warning && (
            <div className="px-3 py-6 text-center text-xs text-gray-500">No matches</div>
          )}
          <ul className="divide-y divide-gray-100">
            {hits.map(h => {
              const Icon = iconForType(h.type);
              return (
                <li key={h.id}>
                  <Link to={h.url || '#'} onClick={() => setOpen(false)} className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50">
                    <Icon size={14} className="mt-0.5 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900 truncate">{h.title || `${h.type} #${h.entity_id}`}</div>
                        <span className="text-[10px] uppercase tracking-wide text-gray-400">{h.type}</span>
                      </div>
                      {h.snippet && <div className="text-xs text-gray-500 truncate">{h.snippet}</div>}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{(h.score * 100).toFixed(0)}%</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

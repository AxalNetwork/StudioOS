import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Search } from 'lucide-react';
import { SECTORS } from '../lib/sectors';

export default function SectorSelect({ label = 'Sector', value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  const filtered = SECTORS.filter(s => s.toLowerCase().includes(search.toLowerCase()));

  const handleSelect = (sector) => {
    onChange(sector);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      {label && (
        <label className="block text-xs text-gray-600 mb-1 dark:text-gray-400">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 hover:border-violet-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
      >
        <span className={value ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}>
          {value || 'Select a sector…'}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <X size={14} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={handleClear} />
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-300 rounded-lg shadow-lg dark:bg-gray-900 dark:border-gray-700">
          <div className="p-2 border-b border-gray-200 dark:border-gray-800">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search sectors…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map(sector => (
                <button
                  type="button"
                  key={sector}
                  onClick={() => handleSelect(sector)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30 ${
                    value === sector
                      ? 'bg-violet-100 text-violet-700 font-medium dark:bg-violet-900/30 dark:text-violet-300'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {sector}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No sectors found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

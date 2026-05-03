import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { BRAND } from '../brand/gvpn';

const LINKS = [
  { label: 'Network', href: '/#network' },
  { label: 'Capital', href: '/#capital' },
  { label: 'Deals', href: '/#deals' },
  { label: 'Spin-Out Lab', href: '/spinout-lab' },
];

export default function PublicNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 backdrop-blur bg-gvpn-ink/80 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-gray-100">
          <img src="/axal-mark.png" alt="" className="h-7 w-7" />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif" }} className="font-semibold tracking-tight">
            {BRAND.short}
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} className="text-sm text-gray-300 hover:text-white transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/login" className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-lg border border-white/15 hover:border-white/30 transition-colors">
            Login
          </Link>
          <Link to="/register" className="text-sm bg-gvpn-violet hover:opacity-90 transition-opacity text-white px-4 py-2 rounded-lg font-medium">
            Apply
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="md:hidden text-gray-200 p-2 rounded-lg hover:bg-white/10"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-white/10 bg-gvpn-ink/95">
          <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-3">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-sm text-gray-300 hover:text-white py-1"
              >
                {l.label}
              </a>
            ))}
            <div className="flex gap-2 pt-2 border-t border-white/10 mt-2">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="flex-1 text-center text-sm text-gray-200 px-4 py-2 rounded-lg border border-white/15"
              >
                Login
              </Link>
              <Link
                to="/register"
                onClick={() => setOpen(false)}
                className="flex-1 text-center text-sm bg-gvpn-violet text-white px-4 py-2 rounded-lg font-medium"
              >
                Apply
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

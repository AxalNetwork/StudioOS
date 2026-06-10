import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const LINKS = [
  { label: 'Network', href: '/#network' },
  { label: 'Platform', href: '/#platform' },
  { label: 'Lanes', href: '/#lanes' },
  { label: 'Spin-Out Lab', href: '/spinout-lab' },
  { label: 'Directory', href: '/directory' },
];

export default function PublicNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/axal-mark.png" alt="Axal VC" className="h-8" />
          <span
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            className="text-lg font-bold text-gray-900"
          >
            Axal VC
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-400 transition-colors px-4 py-2 rounded-lg"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="text-sm bg-violet-600 hover:bg-violet-700 transition-colors text-white px-5 py-2 rounded-lg font-medium"
          >
            Get Started
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="md:hidden text-gray-700 p-2 rounded-lg hover:bg-gray-100"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-3">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-sm text-gray-600 hover:text-gray-900 py-1"
              >
                {l.label}
              </a>
            ))}
            <div className="flex gap-2 pt-2 border-t border-gray-200 mt-2">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="flex-1 text-center text-sm text-gray-700 px-4 py-2 rounded-lg border border-gray-300"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                onClick={() => setOpen(false)}
                className="flex-1 text-center text-sm bg-violet-600 text-white px-4 py-2 rounded-lg font-medium"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

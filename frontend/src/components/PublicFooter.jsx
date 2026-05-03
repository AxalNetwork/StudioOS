import React from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { BRAND } from '../brand/gvpn';

const COLUMNS = [
  {
    title: 'Network',
    items: [
      { label: 'Partners', href: '/#network' },
      { label: 'Capital', href: '/#capital' },
      { label: 'Deals', href: '/#deals' },
      { label: 'Intelligence', href: '/#intelligence' },
      { label: 'Legal', href: '/#legal' },
    ],
  },
  {
    title: 'Products',
    items: [
      { label: 'Spin-Out Lab', href: '/spinout-lab' },
      { label: 'Liquidity Marketplace', href: '/#capital' },
      { label: 'Fund Admin', href: '/#capital' },
    ],
  },
  {
    title: 'Company',
    items: [
      { label: 'About', href: '/' },
      { label: 'Careers', href: 'mailto:hello@axal.vc' },
      { label: 'Press', href: 'mailto:hello@axal.vc' },
      { label: 'Contact', href: 'mailto:hello@axal.vc' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Form ADV', href: 'mailto:compliance@axal.vc' },
      { label: 'Compliance', href: '/risk-disclosures' },
    ],
  },
];

const SOCIALS = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/axalvc' },
  { label: 'X / Twitter', href: 'https://twitter.com/axalvc' },
  { label: 'Telegram', href: 'https://t.me/axalvc' },
];

export default function PublicFooter() {
  return (
    <footer className="bg-gvpn-ink border-t border-white/10 text-gray-300">
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10 mb-12">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-3 text-white">
              <img src="/axal-mark.png" alt="" className="h-7 w-7" />
              <span style={{ fontFamily: "'Space Grotesk', sans-serif" }} className="font-semibold">
                {BRAND.short}
              </span>
            </Link>
            <p className="text-xs text-gray-400 leading-relaxed">
              {BRAND.tagline}
            </p>
            <div className="flex items-center gap-3 mt-4">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-white"
                >
                  {s.label}
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-4">{col.title}</h3>
              <ul className="space-y-2">
                {col.items.map((it) => (
                  <li key={it.label}>
                    {it.href.startsWith('http') || it.href.startsWith('mailto:') || it.href.startsWith('/#') ? (
                      <a href={it.href} className="text-sm text-gray-300 hover:text-white">{it.label}</a>
                    ) : (
                      <Link to={it.href} className="text-sm text-gray-300 hover:text-white">{it.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Partner logo placeholder grid */}
        <div className="border-t border-white/10 pt-8 mb-8">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-4">Network partners</div>
          <div className="grid grid-cols-6 gap-3 opacity-40 hover:opacity-90 transition-opacity">
            {Array.from({ length: 18 }).map((_, i) => (
              <div
                key={i}
                className="h-8 rounded bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-gray-500"
              >
                logo
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <p className="text-xs text-gray-500">
            © 2026 {BRAND.parent}. GVPN is a registered trademark.
          </p>
          <p className="text-xs text-gray-500 max-w-md md:text-right">
            Investment in startups involves a high degree of risk and may result in the loss of your entire investment.
          </p>
        </div>
      </div>
    </footer>
  );
}

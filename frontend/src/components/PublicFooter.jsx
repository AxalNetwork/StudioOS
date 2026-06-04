import React from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';

const socials = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.884v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
      </svg>
    ),
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
  {
    label: 'X / Twitter',
    href: 'https://twitter.com/axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
      </svg>
    ),
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    label: 'Telegram',
    href: 'https://t.me/axalvc',
    icon: <Send size={18} />,
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16.6 5.82c.9.66 1.94 1.04 3.04 1.1v3.08c-1.1-.03-2.18-.31-3.1-.82v5.24c0 4.2-3.56 7.58-7.82 7.58A7.74 7.74 0 0 1 1 14.24c0-4.22 3.44-7.64 7.68-7.64.25 0 .5.02.74.04v3.18a4.7 4.7 0 0 0-.74-.07c-2.48 0-4.48 1.98-4.48 4.46 0 2.47 2 4.45 4.48 4.45 2.58 0 4.62-2.06 4.62-4.64V1h3.3c.02 1.1.4 2.15 1.1 3.04Z"/>
      </svg>
    ),
  },
];

export default function PublicFooter() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 mb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <img src="/axal-mark.png" alt="Axal VC" className="h-8" />
              <span style={{ fontFamily: "'Space Grotesk', sans-serif" }} className="text-lg font-bold text-gray-900">
                Axal VC
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              A global venture partner network connecting founders, partners, and capital.
            </p>
            <div className="flex items-center gap-3">
              {socials.map(({ label, href, icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="text-gray-400 hover:text-violet-600 transition-colors"
                >
                  {icon}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-4">Network</h3>
            <ul className="space-y-2">
              <li><a href="/#network" className="text-sm text-gray-600 hover:text-gray-900">Partners</a></li>
              <li><a href="/#network" className="text-sm text-gray-600 hover:text-gray-900">Capital</a></li>
              <li><a href="/#network" className="text-sm text-gray-600 hover:text-gray-900">Deals</a></li>
              <li><a href="/#network" className="text-sm text-gray-600 hover:text-gray-900">Intelligence</a></li>
              <li><a href="/#network" className="text-sm text-gray-600 hover:text-gray-900">Legal</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-4">Products</h3>
            <ul className="space-y-2">
              <li><Link to="/spinout-lab" className="text-sm text-gray-600 hover:text-gray-900">Spin-Out Lab</Link></li>
              <li><Link to="/articles" className="text-sm text-gray-600 hover:text-gray-900">Articles</Link></li>
              <li><Link to="/register?lane=lp" className="text-sm text-gray-600 hover:text-gray-900">LP Portal</Link></li>
              <li><Link to="/register?lane=partner" className="text-sm text-gray-600 hover:text-gray-900">Partner Network</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-4">Company</h3>
            <ul className="space-y-2">
              <li><Link to="/team" className="text-sm text-gray-600 hover:text-gray-900">About</Link></li>
              <li><Link to="/contact" className="text-sm text-gray-600 hover:text-gray-900">Contact</Link></li>
              <li><Link to="/terms" className="text-sm text-gray-600 hover:text-gray-900">Terms</Link></li>
              <li><Link to="/privacy" className="text-sm text-gray-600 hover:text-gray-900">Privacy</Link></li>
              <li><Link to="/risk-disclosures" className="text-sm text-gray-600 hover:text-gray-900">Risk Disclosures</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs text-gray-500">
              © 2026 Axal VC Management LLC. Platform operated by Axal VC Management LLC.
              Brand and platform IP owned by Axal VC Holdings LLC. All rights reserved.
            </p>
            <p className="text-xs text-gray-500 max-w-md text-right">
              <strong>Disclosure:</strong> Investment in startups involves a high degree of risk and may result in the loss of your entire investment.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

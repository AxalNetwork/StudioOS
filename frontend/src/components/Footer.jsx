import React from 'react';
import { Link } from 'react-router-dom';
import { Facebook, Linkedin, Twitter, Instagram, Youtube } from 'lucide-react';

const socials = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/axalvc',
    icon: <Facebook size={18} />,
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/axalvc',
    icon: <Linkedin size={18} />,
  },
  {
    label: 'X / Twitter',
    href: 'https://twitter.com/axalvc',
    icon: <Twitter size={18} />,
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/axalvc',
    icon: <Instagram size={18} />,
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@axalvc',
    icon: <Youtube size={18} />,
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@axalvc',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.28 6.28 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.89a8.18 8.18 0 0 0 4.78 1.52V7a4.85 4.85 0 0 1-1.01-.31z" />
      </svg>
    ),
  },
];

export default function Footer() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 mb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <img src="/axal-mark.png" alt="Axal VC" className="h-8" />
              <span style={{fontFamily:"'Space Grotesk', sans-serif"}} className="text-lg font-bold text-gray-900">Axal VC</span>
            </div>
            <p className="text-sm text-gray-600 mb-5">The 30-Day Spin-Out Engine for venture capital operations.</p>
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
            <h3 className="font-semibold text-gray-900 mb-4">Platform</h3>
            <ul className="space-y-2">
              <li><Link to="/pipeline" className="text-sm text-gray-600 hover:text-gray-900">Pipeline</Link></li>
              <li><Link to="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">Dashboard</Link></li>
              <li><Link to="/funds" className="text-sm text-gray-600 hover:text-gray-900">VC Fund</Link></li>
              <li><Link to="/liquidity" className="text-sm text-gray-600 hover:text-gray-900">Liquidity</Link></li>
              <li><Link to="/register" className="text-sm text-gray-600 hover:text-gray-900">Become a Partner</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-4">Company</h3>
            <ul className="space-y-2">
              <li><a href="mailto:hello@axal.vc" className="text-sm text-gray-600 hover:text-gray-900">Contact</a></li>
              <li><a href="mailto:support@axal.vc" className="text-sm text-gray-600 hover:text-gray-900">Support</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-4">Legal</h3>
            <ul className="space-y-2">
              <li><Link to="/terms" className="text-sm text-gray-600 hover:text-gray-900">Terms of Service</Link></li>
              <li><Link to="/privacy" className="text-sm text-gray-600 hover:text-gray-900">Privacy Policy</Link></li>
              <li><Link to="/risk-disclosures" className="text-sm text-gray-600 hover:text-gray-900">Risk Disclosures</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs text-gray-500">
              © 2026 Axal Management, LLC. All rights reserved.
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

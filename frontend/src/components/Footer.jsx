import React from 'react';
import { Link } from 'react-router-dom';
import { Github } from 'lucide-react';

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
            <p className="text-sm text-gray-600 mb-4">The 30-Day Spin-Out Engine for venture capital operations.</p>
            <a
              href="https://github.com/guillaumelauzier/axal-vc-studioos"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900"
            >
              <Github size={14} /> View on GitHub
            </a>
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
              <li><a href="https://github.com/guillaumelauzier/axal-vc-studioos" target="_blank" rel="noopener" className="text-sm text-gray-600 hover:text-gray-900">Docs</a></li>
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

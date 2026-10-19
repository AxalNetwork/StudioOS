// D755 §3 and §10 (#1915) — the Token packs section of /plans-and-pricing,
// `#token-packs`, after the plans. One card per pack on sale from the public
// plans-and-packs read: "$25 of tokens", the tokens line, and Buy, which opens
// the checkout for that pack. With none on sale: TOPUP_UNAVAILABLE, no Buy.
import React from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TOKEN_PACKS_ID, TOKEN_PACKS_TITLE, tokenPacks } from '../../lib/plansPricing';

export default function TokenPacksSection({ reading }) {
  const view = tokenPacks(reading);
  return (
    <section id={TOKEN_PACKS_ID} className="scroll-mt-24" data-testid="token-packs">
      <div className="mb-3.5">
        <h2 className="text-[19px] font-bold tracking-[-.01em] text-gray-900 dark:text-gray-100">{TOKEN_PACKS_TITLE}</h2>
      </div>
      {view.state === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-6">
          <Loader2 size={16} className="animate-spin" /> Loading token packs…
        </div>
      )}
      {view.note && <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="token-packs-note">{view.note}</p>}
      {view.packs.length > 0 && (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {view.packs.map((p) => (
            <div key={p.uid} className="flex flex-col bg-white dark:bg-gray-900 rounded-[16px] p-5 border border-gray-200 dark:border-gray-800 shadow-sm" data-testid={`token-pack-${p.uid}`}>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{p.label}</h3>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">{p.line}</p>
              <Link
                to={p.href}
                className="mt-4 inline-flex h-10 items-center justify-center rounded-[10px] bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold"
                data-testid={`token-pack-buy-${p.uid}`}
              >
                Buy
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

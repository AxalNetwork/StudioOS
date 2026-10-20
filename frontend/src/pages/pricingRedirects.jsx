import { Navigate, useLocation } from 'react-router-dom';

// D786 (#2211) — the old pricing addresses land on the one /pricing page
// (D785 D-a), each with its query and hash kept. `/plans-and-pricing/:productId`
// and `/products/:productId` go to `/pricing/products/:productId` through
// `ParamRedirect`.

/** `/plans-and-pricing` → `/pricing`. */
export function PlansAndPricingRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/pricing', search: loc.search, hash: loc.hash }} replace />;
}

/** `/pricing/investor` → the Investor tab, `/pricing?for=investor`, any other query kept. */
export function InvestorPricingRedirect() {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  q.set('for', 'investor');
  return <Navigate to={{ pathname: '/pricing', search: `?${q.toString()}`, hash: loc.hash }} replace />;
}

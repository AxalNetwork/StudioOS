import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { marketsBackHref } from './marketDirectoryQuery.js';

/**
 * D7171 (RMD-05): "‹ Back to Markets" on a sector or market page, naming the
 * directory view it came from. The directory's link carries its query in
 * `from`; this rebuilds it through the directory's own reader, so the link is
 * always `/research/markets` with the directory's params, the row still open,
 * and the directory puts focus back on that row.
 */
export default function MarketsBack({ className = '' }) {
  const [params] = useSearchParams();
  const { href, words } = marketsBackHref(params.get('from'));
  return (
    <Link to={href} data-testid="markets-back"
      className={`inline-flex min-h-[40px] items-center gap-1 text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300 ${className}`}>
      <ArrowLeft size={13} aria-hidden="true" /> Back to Markets
      {words ? <span className="font-normal text-axal-muted dark:text-gray-400"> · {words}</span> : null}
    </Link>
  );
}

import { Link } from 'react-router-dom';
import { ADD_TOKENS_PATH } from '../../lib/aiTokens';
import { PhoneBar } from '../../ui';
import { PanelCard } from './AccountCenter';
import { AI_TOKENS_PAGE, CARDS, NOT_YET, WAITS } from './aiTokensModel';

/**
 * D1277 (#2482) — `/account/usage/ai-tokens`, Usage's third page (Overview ·
 * Cost · AI tokens · Limits · Storage), from the canvas "AI tokens".
 *
 * NOTHING IS READ HERE YET. Each card says "Not read here yet" with its
 * reason, never a figure the Worker did not send. Add tokens goes where every
 * Add tokens goes today (`ADD_TOKENS_PATH`), until #2452's sheet lands.
 */
export default function AiTokensPage() {
  return <div className="flex min-w-0 flex-col gap-4" data-testid="usage-ai-tokens-page">
    <div className="-mx-[22px] lg:hidden"><PhoneBar back={{ label: 'Usage', to: '/account/usage' }} title={AI_TOKENS_PAGE.title} sub={AI_TOKENS_PAGE.sub} /></div>
    <Link to="/account/usage" className="hidden lg:block text-xs font-semibold text-axal-violet dark:text-violet-300">← Usage overview</Link>
    <header className="hidden lg:flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-xl font-extrabold tracking-axal-heading">{AI_TOKENS_PAGE.title}</h2><p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{AI_TOKENS_PAGE.sub}</p></div>
      <Link to={ADD_TOKENS_PATH} className="rounded-[9px] bg-axal-violet px-4 py-2 text-[13px] font-bold text-white" data-testid="ai-tokens-add">Add tokens</Link>
    </header>
    {CARDS.map((c) => <PanelCard key={c.id} title={c.title} data-testid={`ai-tokens-${c.id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid={`ai-tokens-wait-${c.id}`}>{WAITS[c.id]}</p>
    </PanelCard>)}
  </div>;
}

/**
 * D4474 (#4474, part 3 of #3704) — THE BLOCKS OF A SHARED PAGE.
 *
 * `MultiLicenceStudio` and `MultiLicenceSpinoutLab` draw each held licence's
 * part as one block: a title naming the licence (or licences) it serves, then
 * that licence's existing page. Nothing in a block's header switches licence
 * or makes one "active" (#3704, rules 1 and 6): the header is a title only.
 *
 * EACH BLOCK LOADS AND FAILS ON ITS OWN. A block has its own Suspense (its
 * page is lazy, so one slow chunk holds back only that block) and its own
 * error boundary. A block that throws says so in fixed words, never the
 * error's message, with Try again; the other blocks stay drawn. Try again
 * re-mounts the block, so its reads are asked for again.
 */
import React, { Suspense, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { reportError } from '../../lib/log';

/** The fixed words a failed block shows. Never `e.message`. */
export const BLOCK_FAILED = 'This part of the page could not be shown. The other parts are not affected.';

class BlockBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // The block's key only: no name, email or figure reaches the log.
    try { reportError(`licence-block:${this.props.blockKey}`, error); } catch { /* never throw from here */ }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50/70 p-4 text-sm text-gray-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-gray-200" data-testid={`licence-block-failed-${this.props.blockKey}`}>
        <p>{BLOCK_FAILED}</p>
        <button
          type="button"
          onClick={this.props.onRetry}
          className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          data-testid={`button-retry-licence-block-${this.props.blockKey}`}
        >
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
}

function BlockLoading({ title }) {
  return (
    <div className="min-h-[160px] rounded-xl bg-axal-ground p-4 text-sm text-axal-muted dark:bg-gray-800 dark:text-gray-400" role="status" data-testid="licence-block-loading">
      Loading the {title} part of this page…
    </div>
  );
}

/** One block: its title, then its page behind its own boundary and loading state. */
export function LicenceBlock({ block, children }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <section className="space-y-4" aria-labelledby={`licence-block-title-${block.key}`} data-testid={`licence-block-${block.key}`}>
      <h2 id={`licence-block-title-${block.key}`} className="text-[13px] font-extrabold uppercase tracking-wide text-axal-muted dark:text-gray-400" data-testid={`licence-block-title-${block.key}`}>
        {block.title}
      </h2>
      <BlockBoundary key={attempt} blockKey={block.key} onRetry={() => setAttempt((n) => n + 1)}>
        <Suspense fallback={<BlockLoading title={block.title} />}>{children}</Suspense>
      </BlockBoundary>
    </section>
  );
}

/** Every block, in the order given, each drawn by `render(block)`. */
export default function LicenceBlocks({ blocks, render, testId }) {
  return (
    <div className="space-y-10" data-testid={testId}>
      {blocks.map((block) => <LicenceBlock key={block.key} block={block}>{render(block)}</LicenceBlock>)}
    </div>
  );
}

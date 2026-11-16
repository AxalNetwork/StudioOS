// D4618 part 2 (#4618): one Account section behind its own lazy boundary.
//
// `SettingsPage.jsx` mounts one section at a time, and it used to import every
// section's controllers statically, so `/account` fetched Billing's checkout,
// the notification matrix and the privacy cards before drawing the Profile
// pane. `lazySection(load, what)` returns a component that takes the section's
// own props and fetches its module the first time it draws.
//
// While it loads, the section's place holds `LoadingRows` (`account-section-loading`).
// If the module cannot load, or the section throws while drawing, only that
// section says so — Unreadable, with Try again — and the section list, the
// trust strip and every other card stay. Try again asks for the module afresh,
// since `React.lazy` keeps a failed load for good.
//
// A hash that names a card inside the section (`/account/notifications#notif-row-…`)
// cannot be found until the module has drawn, which is after the page's own
// scroll has looked for it; `ScrollToHash` looks again once the section is in.
import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { LoadingRows } from './AccountCenter';

/** The page's anchor rule: `#my-thesis` is the investor card's own, and is left to it. */
export function scrollToHash(hash) {
  if (!hash || hash === '#my-thesis' || typeof document === 'undefined') return;
  let id = hash.slice(1);
  try { id = decodeURIComponent(id); } catch { /* a malformed escape is looked up as written */ }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ block: 'start' });
}

function ScrollToHash() {
  const { hash } = useLocation();
  useEffect(() => { scrollToHash(hash); }, [hash]);
  return null;
}

export class SectionBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div data-testid="account-section-unreadable" className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <Unreadable
            what={this.props.what}
            claim="This section could not load. Try again, or reload the page."
            onRetry={() => { this.props.onRetry?.(); this.setState({ error: null }); }}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export function SectionLoading() {
  return <div data-testid="account-section-loading" aria-busy="true"><LoadingRows lines={4} /></div>;
}

/**
 * @param {() => Promise<any>} load the section's module
 * @param {string} what the section's name, for its Unreadable line
 * @param {string} [name] the export to draw (default: the module's default)
 */
export function lazySection(load, what, name = 'default') {
  const make = () => lazy(() => load().then((m) => {
    if (typeof m?.[name] !== 'function') throw new Error(`lazySection: the module has no export ${name}`);
    return { default: m[name] };
  }));
  let Lazy = make();
  function Section(props) {
    const [, setAttempt] = useState(0);
    return (
      <SectionBoundary what={what} onRetry={() => { Lazy = make(); setAttempt((n) => n + 1); }}>
        <Suspense fallback={<SectionLoading />}>
          <Lazy {...props} />
          <ScrollToHash />
        </Suspense>
      </SectionBoundary>
    );
  }
  Section.displayName = `lazySection(${what})`;
  return Section;
}

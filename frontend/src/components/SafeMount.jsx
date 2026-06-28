import React from 'react';
import { reportError } from '../lib/log';

/**
 * Task #28 — Defense-in-depth wrapper for the global "always-on" mounts
 * (SpinoutLabListener, GlobalPaywallMount, etc.)
 * that sit outside <Routes> at the app root.
 *
 * Without this boundary, a render-time throw inside any of those leaf
 * components blanks the entire React tree — every route, including
 * /login, goes black. That class of crash has bitten this app once
 * already (the SpinoutLabListener "Invalid hook call" reported in
 * Task #28); any future regression in a global mount should degrade
 * to "that one widget is gone" instead of "the whole app is gone".
 *
 * Behaviour:
 *   - Catches any error thrown during render/lifecycle of `children`.
 *   - Logs once via `reportError` with the supplied `name` for triage.
 *   - Renders nothing in place of the broken child so the rest of the
 *     UI keeps working. We deliberately do NOT show a fallback UI here
 *     — these are background widgets, not page content.
 */
export default class SafeMount extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    try {
      reportError(`safe-mount:${this.props.name || 'unnamed'}`, error);
      if (typeof console !== 'undefined' && info?.componentStack) {
        // eslint-disable-next-line no-console
        console.error(info.componentStack);
      }
    } catch { /* never let the boundary itself throw */ }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

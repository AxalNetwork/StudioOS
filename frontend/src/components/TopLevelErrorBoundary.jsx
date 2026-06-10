import React from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { reportError } from '../lib/log';

/**
 * Outermost error boundary — wraps the entire React tree (including
 * AuthProvider and SettingsProvider) in main.jsx.
 *
 * Without this, a throw during provider init (e.g. malformed cached
 * data, an API client error) bubbles to the root and blanks the whole
 * app with no visible recovery UI. Because the root element has no
 * theme class at that point the user sees a dark empty screen.
 *
 * This boundary intentionally avoids all app providers since they may
 * be the thing that threw, so it uses only inline styles + minimal
 * Tailwind classes that don't depend on CSS variables.
 */
export default class TopLevelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      reportError('top-level-boundary', error);
      if (typeof console !== 'undefined' && info?.componentStack) {
        // eslint-disable-next-line no-console
        console.error('[TopLevelErrorBoundary]', error, info.componentStack);
      }
    } catch { /* never let the boundary itself throw */ }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || String(this.state.error) || 'Unknown error';

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          padding: '3rem 1rem',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{
            maxWidth: '32rem',
            width: '100%',
            border: '1px solid #fecaca',
            borderRadius: '0.75rem',
            background: 'rgba(254,242,242,0.7)',
            padding: '1.5rem',
          }}
        >
          <div
            style={{
              marginBottom: '1rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.75rem',
              height: '2.75rem',
              borderRadius: '9999px',
              background: '#fee2e2',
              color: '#dc2626',
            }}
          >
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <h1
            style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              color: '#111827',
              marginBottom: '0.5rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#374151',
              marginBottom: '1rem',
              lineHeight: 1.6,
            }}
          >
            The app failed to start. This is usually caused by a temporary
            issue. Reloading the page almost always fixes it.
          </p>
          <pre
            style={{
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              color: '#b91c1c',
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid #fecaca',
              borderRadius: '0.375rem',
              padding: '0.75rem',
              marginBottom: '1.25rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-words',
              maxHeight: '10rem',
              overflow: 'auto',
            }}
          >
            {msg}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              minHeight: '2.75rem',
              padding: '0.625rem 1rem',
              borderRadius: '0.5rem',
              background: '#111827',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <RefreshCcw size={15} aria-hidden="true" />
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

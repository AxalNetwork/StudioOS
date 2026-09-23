import React from 'react';

/**
 * The two pieces HQ's Topology page (H14) and a branch's "This deployment"
 * zone (S14) both draw — D209.
 *
 * ONE RENDER OF THE RPC SURFACE, NOT TWO. Both tiers read the same payload
 * shape from `services/topology.ts`, one from each side of the binding, and a
 * second copy of this list is how the two screens would come to describe one
 * surface two ways. What differs between them is only who is speaking, so
 * that is a prop.
 */

/** A mono chip. Dashed means declared-and-idle, never failed. */
export function TopologyTag({ children, muted = false, testId }) {
  return (
    <span
      data-testid={testId}
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
        muted
          ? 'border-dashed border-axal-hairline text-axal-faint'
          : 'border-axal-hairline bg-axal-ground text-axal-ink dark:text-gray-200'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * One side of the RPC surface, method by method, in declaration order.
 *
 * `called` and `authenticated` come from the service, which a worker test
 * derives from the classes and their call sites — so a method gaining its
 * first caller fails that test until the payload says so, and this renders
 * whatever the payload says rather than deciding anything itself.
 */
export function RpcSide({ side, heading, exportedBy }) {
  const methods = side?.methods || [];
  const uncalled = methods.filter((m) => !m.called);
  return (
    <div className="py-2" data-testid={`rpc-side-${side?.class || 'unknown'}`}>
      <div className="text-[11.5px] font-bold">{heading}</div>
      <div className="mt-0.5 text-[11px] text-axal-faint">
        <span className="font-mono">{side?.class}</span>, exported by {exportedBy} and called over{' '}
        <span className="font-mono">{side?.called_over}</span>.
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {methods.map((m) => (
          <TopologyTag key={m.name} muted={!m.called} testId={`rpc-method-${m.name}`}>
            {m.name}{m.authenticated ? ' · secret' : ''}
          </TopologyTag>
        ))}
      </div>
      {uncalled.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-axal-faint" data-testid={`rpc-uncalled-${side?.class}`}>
          Declared and not called by anything yet: {uncalled.map((m) => m.name).join(', ')}. A dashed chip is a
          method that exists and has no caller, not one that failed.
        </p>
      )}
    </div>
  );
}

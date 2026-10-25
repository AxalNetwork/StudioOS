/** D1081 (#2946): planned landings, not a claim that a launch or read has shipped. */
export const LOVABLE_FEEDS = Object.freeze([
  Object.freeze({ key: 'experiment_launch', module: 'experiments', direction: 'out', path: 'b', part: 2, built: false, what: 'Build in Lovable launch link' }),
  Object.freeze({ key: 'experiment_app', module: 'experiments', direction: 'in', path: 'c', part: 3, built: false, what: 'App address and live check' }),
  Object.freeze({ key: 'prototype_launch', module: 'prototype_mvp', direction: 'out', path: 'b', part: 2, built: false, what: 'Build in Lovable launch link' }),
  Object.freeze({ key: 'prototype_app', module: 'prototype_mvp', direction: 'in', path: 'c', part: 3, built: false, what: 'App address and live check' }),
]);
/** Only shipped inbound landings are facts the directory may claim to read. */
export function lovablePulls(): Array<{ what: string; module: string }> {
  return LOVABLE_FEEDS.filter(f => f.built && f.direction === 'in').map(f => ({ what: f.what, module: f.module }));
}
export function lovableFedModules(): string[] {
  return [...new Set(lovablePulls().map(f => f.module))];
}

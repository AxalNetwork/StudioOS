/**
 * D886 B3 (#2581): the part of a browser page the Meet adapter uses.
 *
 * The core has no dependencies (B2's README), so the adapter takes this
 * interface, not Playwright's types. A Playwright `Page` satisfies it as is;
 * the image (B8) launches Chromium and hands the page in.
 */

export interface MeetLocator {
  first(): MeetLocator;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  count(): Promise<number>;
  // The function runs in the page, so its elements are untyped here (no DOM types in the core).
  evaluateAll<R, A>(fn: (elements: any[], arg: A) => R, arg: A): Promise<R>;
}

export interface MeetPage {
  goto(url: string, options?: { waitUntil?: 'domcontentloaded' | 'load' }): Promise<unknown>;
  locator(selector: string): MeetLocator;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  exposeFunction(name: string, fn: (...args: any[]) => unknown): Promise<void>;
  addInitScript(script: { content: string }): Promise<void>;
  /** True once the page or its browser has gone. */
  isClosed(): boolean;
}

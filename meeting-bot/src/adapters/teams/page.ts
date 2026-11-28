/**
 * D5812 (#5812, D1451 part 2): the Playwright-backed `TeamsPage`, the
 * browser driver the packaged factory hands `TeamsAdapter`.
 *
 * Before this file the factory cast a raw Playwright `Page` to `TeamsPage`. A
 * Playwright page has no `query(selector, attrs)` and no `onAudio`, so a real
 * Teams run failed at its first read and ended as `platform_blocked`.
 *
 *   query     each VISIBLE element matching the selector, with only the
 *             attributes the adapter names (null when missing). Attributes
 *             only: this file never reads an element's text, so a caption's or
 *             a chat message's words cannot reach Node. A test greps for it.
 *   click,    the first match, refused at once when the page shows none (the
 *   fill      adapter's next read decides), else bounded by `actionTimeoutMs`.
 *   onAudio   the shared in-page capture (`../capture.ts`, the routines Meet
 *             uses), installed before the first navigation. Samples reach a
 *             listener only after `startCapture` (the adapter calls it once
 *             admitted) AND while a listener is subscribed (the core subscribes
 *             only after the notice is posted). Until both hold, the page's
 *             capture switch stays off and any block that still arrives is
 *             dropped in Node.
 *   close     closes the page; capture stops and every listener is dropped.
 *
 * The page type is the subset of Playwright's `Page` this driver calls, so
 * the core keeps no dependency on Playwright (B2's rule).
 */
import type { Unsubscribe } from '../../types.ts';
import { CAPTURE_BINDING, CAPTURE_SCRIPT, decodeBlock } from '../capture.ts';
import type { Attrs, TeamsPage } from '../teams.ts';

export interface TeamsBrowserLocator {
  first(): TeamsBrowserLocator;
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  // The function runs in the page, so its elements are untyped here (no DOM types in the core).
  evaluateAll<R, A>(fn: (elements: any[], arg: any) => R, arg: A): Promise<R>;
}

/** The part of a Playwright `Page` the driver uses. */
export interface TeamsBrowserPage {
  goto(url: string, options?: { waitUntil?: 'domcontentloaded' | 'load' }): Promise<unknown>;
  locator(selector: string): TeamsBrowserLocator;
  evaluate<R, A>(fn: (arg: any) => R, arg: A): Promise<R>;
  exposeFunction(name: string, fn: (...args: any[]) => unknown): Promise<unknown>;
  addInitScript(script: { content: string }): Promise<unknown>;
  close(): Promise<void>;
}

export interface TeamsDriverOptions {
  /** The longest one click or fill on an element the page shows may take. */
  readonly actionTimeoutMs?: number;
}

export const ACTION_TIMEOUT_MS = 5000;

/** What the driver adds to `TeamsPage`: the adapter switches capture on once admitted. */
export type TeamsDriver = TeamsPage & { startCapture(): Promise<void> };

/**
 * Builds the driver on a fresh page. The capture binding and init script are
 * installed here, before any `goto`, so the factory must build the driver
 * before the adapter opens the link.
 */
export async function playwrightTeamsPage(page: TeamsBrowserPage, opts: TeamsDriverOptions = {}): Promise<TeamsDriver> {
  const driver = new PlaywrightTeamsPage(page, opts.actionTimeoutMs ?? ACTION_TIMEOUT_MS);
  await page.exposeFunction(CAPTURE_BINDING, (rate: number, b64: string) => driver.block(rate, b64));
  await page.addInitScript({ content: CAPTURE_SCRIPT });
  return driver;
}

type Listener = (samples: Float32Array, rate: number) => void;

class PlaywrightTeamsPage implements TeamsDriver {
  private readonly page: TeamsBrowserPage;
  private readonly timeout: number;
  private readonly listeners = new Set<Listener>();
  private admitted = false;
  private closed = false;

  constructor(page: TeamsBrowserPage, timeout: number) {
    this.page = page;
    this.timeout = timeout;
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  query(selector: string, attrs: readonly string[]): Promise<readonly Attrs[]> {
    return this.page.locator(selector).evaluateAll(
      (els, names) => els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const out: Record<string, string | null> = {};
          for (const n of names) out[n] = el.getAttribute(n);
          return out;
        }),
      [...attrs],
    );
  }

  async click(selector: string): Promise<void> {
    const el = this.page.locator(selector).first();
    if (!(await el.count())) throw new Error('not on the page');
    await el.click({ timeout: this.timeout });
  }

  async fill(selector: string, text: string): Promise<void> {
    const el = this.page.locator(selector).first();
    if (!(await el.count())) throw new Error('not on the page');
    await el.fill(text, { timeout: this.timeout });
  }

  onAudio(on: Listener): Unsubscribe {
    this.listeners.add(on);
    void this.sync();
    return () => {
      this.listeners.delete(on);
      void this.sync();
    };
  }

  async startCapture(): Promise<void> {
    this.admitted = true;
    await this.sync();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    try { await this.page.close(); } catch { /* already closed */ }
  }

  /** A block from the page. Dropped unless admitted, subscribed and open. */
  block(rate: number, b64: string): void {
    if (!this.forwarding() || typeof b64 !== 'string' || !Number.isFinite(rate) || rate <= 0) return;
    const samples = decodeBlock(b64);
    for (const fn of [...this.listeners]) fn(samples, rate);
  }

  private forwarding(): boolean { return this.admitted && !this.closed && this.listeners.size > 0; }

  /** The page's capture switch follows `forwarding()`. No capture, no audio: a failure here is not the run's. */
  private async sync(): Promise<void> {
    const on = this.forwarding();
    try {
      await this.page.evaluate((value) => {
        const c = (globalThis as unknown as { __eadwynCapture?: { on: boolean } }).__eadwynCapture;
        if (c) c.on = value;
      }, on);
    } catch { /* the page has gone */ }
  }
}

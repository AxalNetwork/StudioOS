/**
 * D4615 (#4615) — saves a settings card's edits one request at a time, so a
 * later choice is never replaced by an earlier one.
 *
 *   · ONE REQUEST IN FLIGHT. Edits made while a save is out are merged into the
 *     next one and sent when it returns, with the revision that response gave.
 *     So responses can never arrive reversed, and a delayed one cannot undo a
 *     newer edit.
 *   · THE VIEW IS WHAT THE MEMBER CHOSE: the last confirmed values, then the
 *     edit in flight, then the edits queued behind it.
 *   · A FAILED SAVE drops only its own edit (those keys go back to the last
 *     confirmed values, unless a queued edit changed them again) and keeps the
 *     queue going. `onError(error, 'failed')` says so.
 *   · A CONFLICT (409: another tab or device saved first) adopts what the
 *     server holds now, drops this tab's unsent edits, and says so through
 *     `onError(error, 'conflict')`: nothing is silently replaced either way.
 *
 * Pure apart from the `send` it is given, so the tests drive it with promises
 * they resolve in any order.
 */

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Shallow merge, one level deeper for plain objects (a category map changes key by key). */
export function mergeDelta(base, delta) {
  const out = { ...base };
  for (const [k, v] of Object.entries(delta || {})) out[k] = isPlain(v) && isPlain(base?.[k]) ? { ...base[k], ...v } : v;
  return out;
}

export class SerialSaver {
  /**
   * @param {object} o
   * @param {object} o.initial      the values as read
   * @param {number} o.revision     the revision read
   * @param {(delta: object, revision: number) => Promise<object>} o.send
   * @param {(response: object) => { values: object, revision: number }} o.accept  what a success means
   * @param {(error: any) => ({ values: object, revision: number } | null)} [o.conflictOf]  the server's current state on a 409
   * @param {(view: object) => void} [o.onChange]
   * @param {(error: any, kind: 'failed' | 'conflict') => void} [o.onError]
   * @param {() => void} [o.onSaved]
   */
  constructor(o) {
    this.confirmed = { ...o.initial };
    this.revision = o.revision ?? 0;
    this.inflight = null;
    this.queued = null;
    this.o = o;
  }

  get view() {
    let v = this.confirmed;
    if (this.inflight) v = mergeDelta(v, this.inflight);
    if (this.queued) v = mergeDelta(v, this.queued);
    return v;
  }

  get busy() { return !!this.inflight; }

  /** Record an edit and save it (now, or after the save in flight). */
  save(delta) {
    this.queued = mergeDelta(this.queued || {}, delta);
    this.o.onChange?.(this.view);
    if (!this.inflight) return this.flush();
    return this.running;
  }

  /** Re-read: adopt server values, dropping nothing that is still queued. */
  reset(values, revision) {
    this.confirmed = { ...values };
    this.revision = revision ?? this.revision;
    this.o.onChange?.(this.view);
  }

  flush() {
    if (!this.queued) return Promise.resolve();
    this.inflight = this.queued;
    this.queued = null;
    const delta = this.inflight;
    this.running = (async () => {
      try {
        const res = await this.o.send(delta, this.revision);
        const { values, revision } = this.o.accept(res);
        this.confirmed = mergeDelta(this.confirmed, values);
        if (revision !== undefined && revision !== null) this.revision = revision;
        this.inflight = null;
        this.o.onSaved?.();
      } catch (e) {
        this.inflight = null;
        const current = e?.status === 409 ? this.o.conflictOf?.(e) : null;
        if (current) {
          this.confirmed = { ...current.values };
          this.revision = current.revision;
          this.queued = null;
          this.o.onChange?.(this.view);
          this.o.onError?.(e, 'conflict');
          return;
        }
        this.o.onError?.(e, 'failed');
      }
      this.o.onChange?.(this.view);
      if (this.queued) await this.flush();
    })();
    return this.running;
  }
}

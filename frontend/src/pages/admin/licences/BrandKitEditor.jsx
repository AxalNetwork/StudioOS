/**
 * #4707 — the HQ licence page's the white-label brand kit. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Field } from './licenceShared';

/* ------------------------------------------------------------------ *
 * D198 — the brand kit, drawn only for a white-label licence          *
 * ------------------------------------------------------------------ */

export function BrandKitEditor({ licence, onSaved }) {
  const kit = licence.brand_kit || null;
  const [primary, setPrimary] = useState(kit?.primary_hex || '');
  const [accent, setAccent] = useState(kit?.accent_hex || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // The mark's URL carries a cache-buster keyed on the kit's own stamp. The
  // route's path does not change when a mark is replaced — it is the licence's
  // uid — so without this the browser would go on drawing the previous logo.
  const markSrc = kit?.mark_url ? `${kit.mark_url}?v=${encodeURIComponent(kit.updated_at || '')}` : null;

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); onSaved?.(); }
    catch (e) {
      reportError('AdminLicences:brandKit', e);
      setErr(e?.message || 'That did not go through.');
    } finally { setBusy(false); }
  }

  // The same condition the server enforces, mirrored so the form does not
  // offer a save the route would refuse. `#rgb` and `#rrggbb` are both what
  // `cleanHex` admits, so the two agree rather than the client being stricter.
  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const canSave = HEX.test(primary.trim()) && HEX.test(accent.trim());

  // UNREADABLE IS NOT ABSENT. A database without migration 281 has no store,
  // and "this licence has no kit" would be a claim about the licence rather
  // than about the database.
  if (licence.brand_kit_available === false) {
    return (
      <div data-testid="licence-brand-kit-unreadable">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Brand kit</h3>
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
          {licence.brand_kit_reason || 'The brand-kit store could not be read.'} Nothing below is a
          statement about this licence — it is a statement about this database.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="licence-brand-kit">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Brand kit</h3>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
        A white-label operator sets their own mark. HQ does not approve it. HQ captures it here
        because a licence is issued before any administrator is named on it, so at issue time
        there is nobody else to type it — and the colours are required before the licence can be
        activated, because a shell with no palette of its own renders Axal&rsquo;s.
      </p>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Field
            label="Public name"
            value={licence.brand_name || null}
            hint="This is the brand name already on the licence. A separate public-name column does not exist."
          />

          <div data-testid="licence-brand-colours">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Colours</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-400">
                Primary
                <input
                  type="text" value={primary} onChange={(e) => setPrimary(e.target.value)}
                  placeholder="#0f766e" spellCheck={false}
                  className="w-28 rounded-md border border-gray-300 px-2 py-1 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-900"
                />
                <span
                  className="inline-block h-5 w-5 rounded border border-gray-300 dark:border-gray-700"
                  style={HEX.test(primary.trim()) ? { backgroundColor: primary.trim() } : undefined}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-gray-400">
                Accent
                <input
                  type="text" value={accent} onChange={(e) => setAccent(e.target.value)}
                  placeholder="#f59e0b" spellCheck={false}
                  className="w-28 rounded-md border border-gray-300 px-2 py-1 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-900"
                />
                <span
                  className="inline-block h-5 w-5 rounded border border-gray-300 dark:border-gray-700"
                  style={HEX.test(accent.trim()) ? { backgroundColor: accent.trim() } : undefined}
                />
              </label>
              <button
                type="button" disabled={busy || !canSave}
                onClick={() => run(() => api.licenceBrandSet(licence.uid, {
                  primary_hex: primary.trim(), accent_hex: accent.trim(),
                }))}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save colours
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Both are required together. A value that is not a hex colour is refused rather than
              replaced with a default &mdash; a brand colour quietly swapped for a fallback is a
              wrong claim about somebody&rsquo;s brand, which is worse than a missing one.
            </p>
          </div>

          <div data-testid="licence-brand-mark">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Mark</div>
            {markSrc ? (
              <div className="mt-1 flex items-center gap-3">
                {/* WHITE IN BOTH THEMES, deliberately. A mark is usually drawn
                    in the operator's own dark ink, and on a dark ground it
                    would disappear — so the backing does not follow the theme.
                    The pair is spelled out so the guard reads it as a decision
                    rather than an omission. */}
                <img
                  src={markSrc} alt={`${licence.brand_name} mark`}
                  className="h-10 w-auto max-w-[140px] rounded border border-gray-200 bg-white object-contain p-1 dark:border-gray-800 dark:bg-white"
                />
                <span className="text-[11px] text-gray-500">
                  {kit.mark_mime}{kit.mark_bytes ? ` · ${Math.round(kit.mark_bytes / 1024)} KB` : ''}
                </span>
                <button
                  type="button" disabled={busy}
                  onClick={() => run(() => api.licenceBrandMarkRemove(licence.uid))}
                  className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="mt-0.5 text-sm text-gray-400">Not recorded</div>
            )}
            <input
              type="file" accept="image/png,image/jpeg,image/svg+xml" disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) run(() => api.licenceBrandMarkUpload(licence.uid, file));
              }}
              className="mt-2 block w-full text-[11px] text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-2 file:py-1 file:text-[11px]"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              PNG, JPEG or SVG, up to 512 KB. An SVG is sanitised before it is stored, so a mark
              can never carry a script into a shell that renders it.
            </p>
          </div>
        </div>

        {/* H26's preview. Every value in it comes from a field above or from
            the licence; nothing here is sample data. */}
        <div
          className="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          data-testid="licence-brand-preview"
        >
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Preview</div>
          <div
            className="mt-2 flex items-center gap-3 rounded-md p-3"
            style={HEX.test(primary.trim()) ? { backgroundColor: primary.trim() } : undefined}
          >
            {markSrc
              ? <img src={markSrc} alt="" className="h-8 w-auto max-w-[110px] object-contain" />
              : <span className="text-[11px] text-white/80">No mark</span>}
            <span className="text-sm font-semibold text-white">{licence.brand_name}</span>
            <span
              className="ml-auto inline-block h-4 w-4 rounded-full border border-white/40"
              style={HEX.test(accent.trim()) ? { backgroundColor: accent.trim() } : undefined}
            />
          </div>
          <dl className="mt-3 space-y-2 text-[11px]">
            <div>
              <dt className="uppercase tracking-wide text-gray-500">Email from</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                {licence.domain?.hostname
                  ? `${licence.brand_name} <hello@${licence.domain.hostname}>`
                  : 'Derived from the public name and the bound host. No host is bound yet, so there is nothing to derive it from.'}
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-gray-500">Issued at deploy</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                The platform host the deploy issued. It is not collected in this kit &mdash; the
                custom host the Admin binds is on the Deploy step.
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-gray-500">&ldquo;Powered by Axal VC&rdquo;</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                Hidden, and not a stored switch. Nothing in the shell renders a platform credit at
                all, so a setting here would turn something off that is already off.
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-gray-500">Exclusive vs other white-labels</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                Not stored. Territory exclusivity is enforced on the territory itself; a separate
                flag would relax that constraint rather than add to it.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

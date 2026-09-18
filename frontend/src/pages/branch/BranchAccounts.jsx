/**
 * Branch · Accounts — canvas S2, plus the half of S8 that is true (D129).
 *
 * WHAT MADE THIS PAGE POSSIBLE, AND WHAT IT STILL CANNOT DRAW. D127 settled
 * that a seat is a consequence of `users.role`: a branch counts its own seats
 * because every account in this database *is* this branch's. So the four tiles
 * S2 draws are real numbers now. What D127 also settled is that this is a
 * DEFINITION, not a seat ledger — no seat has an id, nobody is assigned or
 * released — and S8's ledger table (Seat · Holder · Licence · State, with
 * assign and release) therefore does not ship. Drawing it would mean inventing
 * every cell in it. What S8 contributes that IS true is the arithmetic:
 * free = licensed − used, and the request path being an escalation rather than
 * a number to edit.
 *
 * THE MEMBERS COLUMN IS HEADED ROLE, NOT SEAT, for the same reason. The canvas
 * draws a Seat column; there is no seat id to put in it, so the column names
 * what the value actually is. D127 called this consequence out in advance
 * rather than leaving it to be discovered here.
 *
 * WHY THE SEARCH NEEDS NO TERRITORY PREDICATE. S0's first wall rule is that
 * every count is already filtered — "not a global query with a where-clause
 * bolted on afterwards. There is no global view underneath to leak." On a
 * branch that is literally true: `/api/admin/users` runs against this
 * deployment's D1, which holds this branch's accounts and no others. The scope
 * caption says what is being searched (wall rule 2); it does not narrow
 * anything, because there is nothing to narrow.
 *
 * EVERY ABSENCE HERE IS A DIFFERENT CLAIM, and they must not collapse into one
 * zero. An unreadable licence is not "no seats licensed"; `seats_used_by_type:
 * null` (the count failed) is not a role with no accounts (a measured zero);
 * and a search that returned nothing is not an empty directory. Each renders
 * its own state.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, ArrowUpRight } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable, titleCase } from '../../ui';
import BranchZone from './BranchZone';
import { branchLabel } from '../../lib/shellRole';

const UNAVAILABLE = Symbol('unavailable');

/**
 * The vocabulary a licence is SOLD in, mirroring `SEAT_ROLES` in
 * `cloudflare-worker/src/rpc/branchOps.ts`. Kept in this order because it is
 * the order `licence_seats.seat_type`'s CHECK declares, and the tiles read
 * left-to-right as the licence does. The worker's copy is the one the
 * `branch_seats_from_role.test.ts` parity test pins against migration 187; this
 * copy is display order only and carries no arithmetic.
 */
const SEAT_TYPES = ['founder', 'investor', 'advisor', 'partner'];

/**
 * The canvas's amber threshold. EXPORTED so the test reads the number rather
 * than restating it — an assertion that hardcodes 0.88 passes after somebody
 * changes the tile to 0.9, which is the drift it was written to catch.
 */
export const AMBER_AT = 0.88;

/**
 * A tile's state, derived once so the class and the wording cannot disagree.
 *
 * `over` EXISTS BECAUSE THE ALTERNATIVE IS A LIE. If a branch holds more
 * accounts of a type than HQ licensed seats for, `free` is negative. Clamping
 * it to 0 would render "0 free" — indistinguishable from exactly-full, and it
 * would hide the one condition on this screen that needs HQ told about it.
 * `licensed === 0` is the same question asked at the boundary: with nothing
 * licensed, a ratio has no value, so it is answered by the count rather than by
 * a division that would throw an Infinity at the threshold.
 */
export function seatState(used, licensed) {
  if (licensed <= 0) return used > 0 ? 'over' : 'unlicensed';
  if (used > licensed) return 'over';
  return used / licensed >= AMBER_AT ? 'tight' : 'ok';
}

const TILE_TONE = {
  ok: 'border-axal-hairline',
  tight: 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5',
  over: 'border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5',
  unlicensed: 'border-axal-hairline',
};

export default function BranchAccounts({ user }) {
  const [licence, setLicence] = useState(null);   // null = loading, UNAVAILABLE = failed
  const [dir, setDir] = useState(null);           // the account directory envelope
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');   // what the loaded page actually answers
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [asked, setAsked] = useState(false);
  const debounce = useRef(null);

  // D151 — ONE NAME FOR THE BRANCH. This line was the first copy and
  // `BranchZone`'s scope sentence would have been the second, so the
  // derivation moved to `lib/shellRole.js` beside `branchOfUser`, which
  // already answers questions about the same `/me.branch` object. The
  // FALLBACK stays here, because a fallback is a human-written sentence
  // (D117's split) and the two callers word theirs differently.
  const brand = branchLabel(user);

  const loadLicence = useCallback(() => {
    setLicence(null);
    api.myLicence().then(setLicence, (e) => {
      reportError('BranchAccounts:licence', e);
      setLicence(UNAVAILABLE);
    });
  }, []);

  const loadDirectory = useCallback((q) => {
    setDir(null);
    api.adminListUsers({ envelope: 1, ...(q ? { q } : {}) }).then(
      (payload) => { setDir(payload); setSearched(q || ''); },
      (e) => {
        reportError('BranchAccounts:directory', e);
        setDir(UNAVAILABLE);
      },
    );
  }, []);

  useEffect(() => { loadLicence(); loadDirectory(''); }, [loadLicence, loadDirectory]);

  // THE TWO-CHARACTER GATE IS THE SERVER'S RULE, HONOURED HERE SO A ONE-LETTER
  // KEYSTROKE DOES NOT SPEND A ROUND TRIP ON A 400. Clearing the box is not a
  // one-character query — it is a reload of the unfiltered page, so it is
  // allowed through.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 1) return undefined;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => loadDirectory(q), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, loadDirectory]);

  const requestSeats = async (e) => {
    e.preventDefault();
    if (asking) return;
    setAsking(true);
    setAskError('');
    try {
      await api.branchEscalate({
        kind: 'seat_increase',
        subject: 'More seats for this territory',
        detail: 'Raised from Accounts. Seats are a licence term, so this is a request to HQ rather '
          + 'than a number this branch can change.',
      });
      setAsked(true);
    } catch (err) {
      reportError('BranchAccounts:requestSeats', err);
      setAskError(err?.message || 'The request could not be raised, so HQ has not been asked.');
    } finally {
      setAsking(false);
    }
  };

  const licenceReady = licence && licence !== UNAVAILABLE && licence.licence;
  const dirReady = dir && dir !== UNAVAILABLE;

  const seatsLicensed = licenceReady ? (licence.licence.seats || {}) : {};
  const seatsUsed = licenceReady ? licence.licence.seats_used_by_type : null;
  const seatBasis = licenceReady ? licence.licence.seats_used_basis : null;

  const tiles = useMemo(() => {
    if (!seatsUsed) return [];
    return SEAT_TYPES.map((type) => {
      const used = Number(seatsUsed[type] ?? 0);
      const licensed = Number(seatsLicensed[type] ?? 0);
      return { type, used, licensed, free: licensed - used, state: seatState(used, licensed) };
    });
  }, [seatsUsed, seatsLicensed]);

  const rows = dirReady ? (dir.results || []) : [];
  const total = dirReady ? dir.total : null;
  const byRole = dirReady ? (dir.by_role || {}) : {};
  const exploring = dirReady ? Number(byRole.exploring ?? 0) : null;

  // WHAT THE RAIL MAY SAY (D126): only what this page loaded. A failed read
  // contributes no line rather than a zero, and `coverageNote` names which —
  // an empty rail on a page that loaded nothing is TRUE, and on a page that
  // loaded something it would be a lie.
  const coverage = [
    dirReady && total !== null ? `${total} ${total === 1 ? 'account' : 'accounts'} in this territory` : null,
    dirReady && exploring !== null ? `${exploring} exploring, holding no seat` : null,
    seatsUsed && licenceReady
      ? `${licence.licence.seats_used} of ${licence.licence.seats_licensed} seats used, counted by role`
      : null,
  ].filter(Boolean);

  const bothFailed = dir === UNAVAILABLE && licence === UNAVAILABLE;

  return (
    <BranchZone
      workspace="Accounts"
      user={user}
      stance="Read-only summary of this territory's accounts"
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (bothFailed
          ? 'Neither the directory nor the licence could be read, so there is nothing to read back — this is not a claim that the territory has no accounts.'
          : 'Loading this territory\'s accounts…')}
      unavailable={[
        ['A seat ledger', 'Seats used is counted from roles (D127). No seat has an id, so nobody is assigned or released and a vacant seat cannot be shown.'],
        ['Accounts in another territory', 'This deployment holds one territory\'s accounts. There is no cross-branch read behind this page.'],
      ]}
    >
      <div className="space-y-4" data-testid="branch-accounts-page">
        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Users size={13} /> S2 · Accounts
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">
            Seats licensed against seats used, and the people holding them
          </h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Seats are set by HQ, so the number licensed is a licence term rather than a field on this
            page. Running out is a request to make, and the path is below.
          </p>
        </header>

        {/* ── Seat tiles (S2) with S8's free-and-over arithmetic ── */}
        <Card className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Seats</h2>
            {licenceReady && licence.as_of && (
              <span className="text-[10.5px] text-axal-faint" data-testid="branch-seats-as-of">
                Licence as of {new Date(licence.as_of).toLocaleDateString()} · pushed by HQ
              </span>
            )}
          </div>

          {licence === UNAVAILABLE ? (
            <div className="mt-3" data-testid="branch-seats-unreadable">
              <Unreadable
                what="The licence copy"
                claim="What HQ licensed is unknown — this is not a claim that no seats are licensed."
                onRetry={loadLicence}
              />
            </div>
          ) : !licenceReady ? (
            <p className="mt-3 text-[12px] text-axal-faint">Loading the licence…</p>
          ) : !seatsUsed ? (
            <div className="mt-3 text-[12px]" data-testid="branch-seats-uncounted">
              Seats used:{' '}
              <Unrecorded reason="The account table could not be counted, so seats used is unknown rather than zero. Seats licensed is unaffected.">
                Not counted
              </Unrecorded>
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="branch-seat-tiles">
                {tiles.map((t) => (
                  <div
                    key={t.type}
                    className={`rounded-xl border p-3 ${TILE_TONE[t.state]}`}
                    data-testid={`branch-seat-tile-${t.type}`}
                    data-seat-state={t.state}
                  >
                    <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      {titleCase(t.type)}
                    </div>
                    <div className="mt-1 text-[19px] font-extrabold tabular-nums tracking-tight">
                      {t.used} <span className="text-[12px] font-bold text-axal-muted">of {t.licensed}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-semibold tabular-nums">
                      {t.state === 'over' ? (
                        <span className="text-red-700 dark:text-red-300">
                          over by {t.used - t.licensed}
                        </span>
                      ) : t.state === 'unlicensed' ? (
                        <span className="text-axal-faint">no seats of this type licensed</span>
                      ) : (
                        <span className={t.state === 'tight' ? 'text-amber-700 dark:text-amber-300' : 'text-axal-muted'}>
                          {t.free} free
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {seatBasis && (
                <p className="mt-2 text-[10.5px] leading-relaxed text-axal-faint" data-testid="branch-seat-basis">
                  {seatBasis}
                </p>
              )}
            </>
          )}

          {/* ── S8's request path: an escalation, not an input ── */}
          <div className="mt-4 border-t border-axal-hairline pt-3">
            {asked ? (
              <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="branch-seats-asked">
                Raised with HQ. It is in the outbound lane on{' '}
                <Link className="underline" to="/branch/approvals">Approvals</Link>, with its answer when it comes.
              </p>
            ) : (
              <form onSubmit={requestSeats} data-testid="branch-seats-request">
                <p className="text-[11.5px] text-axal-muted">
                  Need more? Seats are a licence term, so this asks HQ rather than changing a number here.
                </p>
                <button
                  type="submit"
                  disabled={asking}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
                >
                  <ArrowUpRight size={13} /> {asking ? 'Raising…' : 'Request more seats from HQ'}
                </button>
                {askError && (
                  <p className="mt-2 text-[11.5px] text-red-700 dark:text-red-300" data-testid="branch-seats-request-error">
                    {askError}
                  </p>
                )}
              </form>
            )}
          </div>
        </Card>

        {/* ── Members (S2), searched (S0 wall rule 2) ── */}
        <Card className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Members</h2>
            <span className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
              Territory-scoped
            </span>
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-xl border border-axal-hairline bg-axal-ground px-2.5 py-2">
            <Search size={14} className="shrink-0 text-axal-faint" />
            <input
              className="w-full bg-transparent text-[12.5px] outline-none"
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={brand ? `Search ${brand} accounts` : 'Search this territory\'s accounts'}
              data-testid="branch-account-search"
            />
          </label>
          {/* THE SCOPE LINE IS A RESTING LABEL, NOT A PLACEHOLDER. A placeholder
              vanishes the moment somebody types, which is exactly when the
              question "what am I searching?" is being asked. */}
          <p className="mt-1.5 text-[11px] text-axal-faint" data-testid="branch-account-scope">
            {brand ? `Searching ${brand} accounts` : 'Searching this territory\'s accounts'}
          </p>

          {dir === UNAVAILABLE ? (
            <div className="mt-3" data-testid="branch-members-unreadable">
              <Unreadable
                what="The account directory"
                claim="This is not a claim that the territory has no members."
                onRetry={() => loadDirectory(query.trim())}
              />
            </div>
          ) : !dirReady ? (
            <p className="mt-3 text-[12px] text-axal-faint">Loading members…</p>
          ) : rows.length === 0 ? (
            <p className="mt-3 text-[12px] text-axal-muted" data-testid="branch-members-empty">
              {searched
                ? `No account in this territory matches “${searched}”.`
                : 'No accounts in this territory yet.'}
            </p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      <th className="py-1.5 pr-3">Member</th>
                      {/* HEADED ROLE, NOT SEAT (D127) — there is no seat id to show. */}
                      <th className="py-1.5 pr-3">Role</th>
                      <th className="py-1.5">State</th>
                    </tr>
                  </thead>
                  <tbody data-testid="branch-members-rows">
                    {rows.map((m) => (
                      <tr key={m.id} className="border-t border-axal-hairline align-top">
                        <td className="py-1.5 pr-3">
                          <span className="block font-semibold">{m.name || m.email}</span>
                          {m.name && <span className="block text-[10.5px] text-axal-faint">{m.email}</span>}
                        </td>
                        <td className="py-1.5 pr-3">{titleCase(m.role)}</td>
                        <td className="py-1.5">{m.is_active ? 'Active' : 'Deactivated'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* THE TABLE IS A PAGE AND SAYS SO. D128 fixed the HQ panel that
                  rendered a page as a total; this caption is the same rule kept
                  rather than re-broken on a new surface. */}
              <p className="mt-2 text-[10.5px] text-axal-faint" data-testid="branch-members-showing">
                Showing {rows.length} of {total === null ? 'an unknown number of' : total}
                {searched ? ` matching “${searched}”` : ' accounts in this territory'}.
              </p>
            </>
          )}
        </Card>

        {/* ── Exploring (S2's third board) ── */}
        <Card className="p-4">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">Exploring</h2>
          <p className="mt-1 text-[11.5px] text-axal-muted">
            Signed up in this territory and holding no licence, so holding no seat.
          </p>
          {dir === UNAVAILABLE ? (
            <div className="mt-3" data-testid="branch-exploring-unreadable">
              <Unreadable
                what="The account directory"
                claim="How many are exploring is unknown, not zero."
                onRetry={() => loadDirectory(query.trim())}
              />
            </div>
          ) : !dirReady ? (
            <p className="mt-3 text-[12px] text-axal-faint">Loading…</p>
          ) : (
            <p className="mt-2 text-[12.5px]" data-testid="branch-exploring-count">
              <span className="text-[19px] font-extrabold tabular-nums">{exploring}</span>{' '}
              <span className="text-axal-muted">
                {exploring === 1 ? 'account is' : 'accounts are'} exploring.{' '}
                <Link className="underline" to="/admin/exploring">Review them</Link>.
              </span>
            </p>
          )}
        </Card>
      </div>
    </BranchZone>
  );
}

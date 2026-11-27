// Replaces the design's 9-row RACI matrix.
//
// Axal has NO per-domain responsibility data — project_members.role is only
// owner | cofounder | advisor. Rendering an "Accountable / Supporting /
// Approval" grid would be pure invention, so this card renders only values
// that exist: the founders you named, the titles you typed, the real
// day-to-day decision maker, the real threshold, and the real reserved
// matters. `reason` is shown so the absence is explained, not silent.
import React from 'react';

export default function RolesAndReservedMatters({ roles, reason }) {
  const r = roles || {};
  const rows = Array.isArray(r.rows) ? r.rows : [];
  const matters = Array.isArray(r.reservedMatters) ? r.reservedMatters : [];

  return (
    <div data-testid="card-roles">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
        Role &amp; responsibility matrix
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mb-3">{reason}</p>

      {rows.length === 0 ? (
        <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="roles-empty">
          No founders named yet — add them in the Equity split clause above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[320px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 py-2 pr-3 text-left">Founder</th>
                <th className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 py-2 pr-3 text-left">Title</th>
                <th className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60" data-testid={`role-row-${i}`}>
                  <td className="py-2 pr-3 text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">
                    {row.name}
                    {/* The one team-record fact that IS true per founder: this
                        name matches a member of the project team. */}
                    {row.matchedMember && (
                      <span className="ml-1.5 text-[9.5px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 rounded px-1.5 py-0.5 align-middle" data-testid={`role-matched-${i}`}>
                        on team record
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[12px] text-gray-600 dark:text-gray-300">{row.title}</td>
                  <td className="py-2 text-[11px] text-gray-400 dark:text-gray-500">{row.titleSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Day-to-day decisions</div>
          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 mt-0.5">{r.dayToDay}</div>
        </div>
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Strategic threshold</div>
          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 mt-0.5">{r.thresholdLabel}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
          Reserved matters — unanimous consent (§4.2)
        </div>
        {matters.length === 0 ? (
          <p className="text-[11.5px] text-amber-700 dark:text-amber-300">
            None listed — §4.2 will generate with an empty list.
          </p>
        ) : (
          <ul className="space-y-1">
            {matters.map((m, i) => (
              <li key={i} className="text-[12px] text-gray-600 dark:text-gray-300 flex gap-2" data-testid={`reserved-matter-${i}`}>
                <span className="text-gray-300 dark:text-gray-600">•</span>{m}
              </li>
            ))}
          </ul>
        )}
      </div>

      {r.note && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">{r.note}</p>
      )}
    </div>
  );
}

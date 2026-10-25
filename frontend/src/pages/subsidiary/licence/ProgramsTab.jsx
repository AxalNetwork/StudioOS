/**
 * D981 (#2376) — the Licences page's Programs tab (canvas board GR7),
 * `/admin/my-licence/programs`.
 *
 * What HQ lets this studio run, read only: HQ decides, the studio asks. No
 * grant is stored yet (D981 §2), so every program HQ can grant reads "Not
 * recorded" with why, never "Not granted". The programs HQ keeps, and the two
 * not ready to grant, say so as the canvas fixes. Requesting a program and the
 * partner deal types come with D981's parts.
 */
import React from 'react';
import { PROGRAMS, adminCell, programGroups } from '../../../lib/programGrants';

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const TONE = {
  unrecorded: 'border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
  hq: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
  notready: 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500',
};

export default function ProgramsTab() {
  const groups = programGroups();
  let i = 0;
  return (
    <div className="space-y-4" data-testid="licence-programs">
      <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="licence-programs-rule">
        HQ decides which programs your studio runs, and on what terms. You will be able to ask for a change here.
      </p>
      <div className={CARD}>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th scope="col" className="py-1.5 pr-3">Program</th>
              <th scope="col" className="py-1.5 pr-3">Status</th>
              <th scope="col" className="py-1.5">What it means</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const rows = PROGRAMS.slice(i, i + g.span);
            i += g.span;
            return (
              <tbody key={g.group}>
                <tr><th scope="rowgroup" colSpan={3} className="pt-3 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{g.group}</th></tr>
                {rows.map((p) => {
                  const c = adminCell(p);
                  return (
                    <tr key={p.key} className="border-t border-gray-100 dark:border-gray-800" data-testid={`licence-program-${p.key}`}>
                      <th scope="row" className="py-2 pr-3 font-semibold text-gray-900 dark:text-gray-100">{p.name}</th>
                      <td className="py-2 pr-3"><span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[c.kind]}`}>{c.text}</span></td>
                      <td className="py-2 text-xs text-gray-600 dark:text-gray-400">{c.line}</td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <div className={CARD} data-testid="licence-programs-deal-types">
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Partner deal types you may offer</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Not recorded. HQ sets these per licence once the grant store exists; until then every licence offers the same five.</p>
      </div>
    </div>
  );
}

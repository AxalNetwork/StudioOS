/**
 * D1270 (#2381) — the parts of HQ › Platform › Promo codes that are not the
 * list itself: the Usage tab's waits (PRM7, PRM8) and one code's drawer at its
 * address (PRM2), over today's list. Mounted by `../ConsolePages.jsx`'s
 * `PromoCodesPage`.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { BASE, NOT_YET, WAITS } from './promoModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export function PromoWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`promo-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

export function PromoUsage() {
  return <section className={box} data-testid="promo-usage"><h2 className="m-0 text-[15px] font-bold">Usage</h2><PromoWait id="usage" /></section>;
}

/** PRM2: the drawer the address names; the list stays under it. */
export function PromoDrawer({ id }) {
  if (!id) return null;
  return (
    <aside role="dialog" aria-label={`Promo code ${id}`} className={box} data-testid="promo-drawer">
      <div className="flex items-center justify-between">
        <h2 className="m-0 font-mono text-[15px] font-bold">{id}</h2>
        <Link to={BASE} className="text-[13px] font-semibold underline">Close</Link>
      </div>
      <PromoWait id="drawer" />
    </aside>
  );
}

/** The lines the list carries today: the redeemed figure is a lower bound, and plan scope waits. */
export function PromoNotes() {
  return <section className={box} data-testid="promo-notes"><PromoWait id="redeemed" /><PromoWait id="scope" /></section>;
}

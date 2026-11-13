import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

// Task #23 — the Axal VC Spin-Out "Review the deal" slide surfaces the
// interactive share CTA (Join & open the deal) inside the slide itself.
// That card is share-mode-only and needs viewer context (share token,
// view id, etc.) that lives in PitchDeckPrintPage, so it is injected via
// this context rather than baked into the otherwise self-contained deck
// template. Default null → no card (editor preview, thumbnail, export).
export const ReviewDealSlotContext = createContext<ReactNode>(null);

export const useReviewDealSlot = (): ReactNode => useContext(ReviewDealSlotContext);

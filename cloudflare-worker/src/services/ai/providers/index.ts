/** D851 (#2474): one adapter per provider, keyed as `catalogue.ts`'s `ProviderId`. */
import type { ProviderId } from '../catalogue';
import { anthropic } from './anthropic';
import type { ProviderAdapter } from './types';

export const ADAPTERS: Readonly<Record<ProviderId, ProviderAdapter>> = Object.freeze({ anthropic });

export type { ProviderAdapter, ProviderErrorKind, ProviderOutcome, ProviderRequest } from './types';

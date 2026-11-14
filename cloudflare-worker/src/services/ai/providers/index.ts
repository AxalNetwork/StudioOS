/** D851 (#2474): one adapter per provider, keyed as `catalogue.ts`'s `ProviderId`. */
import type { ProviderId } from '../catalogue';
import { anthropic } from './anthropic';
import { chatCompletions } from './gateway';
import type { GatewayAdapter, ProviderAdapter } from './types';

export const ADAPTERS: Readonly<Record<ProviderId, ProviderAdapter>> = Object.freeze({ anthropic });

/** D4556 (#4556): one adapter per AI Gateway request format (Path A), keyed as `GatewayTextModel.format`. */
export const GATEWAY_ADAPTERS: Readonly<Record<'chat_completions', GatewayAdapter>> = Object.freeze({ chat_completions: chatCompletions });

export type { GatewayAdapter, GatewayOutcome, ProviderAdapter, ProviderErrorKind, ProviderOutcome, ProviderRequest } from './types';

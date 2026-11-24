// D7004 (#7004): types for the Worker's import of `structuredData.js` (the record card, D1439).
export type JsonLd = Record<string, unknown>;
export const ORG_NAME: string;
export const ORG_LOGO: string;
export const FORBIDDEN_LD_KEYS: readonly string[];
export function compact(value: unknown): unknown;
export function isoDate(value: unknown): string | null;
export function organizationLd(): JsonLd;
export function articleLd(record?: Record<string, unknown>): JsonLd | null;
export function eventLd(record?: Record<string, unknown>): JsonLd | null;
export function breadcrumbLd(items: Array<{ name?: unknown; path?: string | null }>): JsonLd | null;
export function helpGuideBreadcrumbLd(trail: { areaId?: string; areaTitle?: unknown; guideTitle?: unknown }): JsonLd | null;
export function structuredDataFor(pathname: string): JsonLd[];
export function jsonLdScript(payload: unknown): string;
export function structuredDataBlock(payloads: ReadonlyArray<unknown> | null | undefined): string;
export function withStructuredData(html: string, payloads: ReadonlyArray<unknown> | null | undefined): string;

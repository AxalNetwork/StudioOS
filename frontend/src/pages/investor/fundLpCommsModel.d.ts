/** Types for `fundLpCommsModel.js` (D553), so the Worker's typecheck can import the comms kinds' labels (D6242). */
export const LP_TYPES: readonly string[];
export const LP_TYPE_LABELS: Record<string, string>;
export const COMM_KIND_LABELS: Record<string, string>;
export function lpTypeLabel(lp: any): string | null;
export function typeChips(rows: any[]): any;
export function matchesType(row: any, filter: string): boolean;
export const UNTYPED: string;
export function reminderSubject(line: any): string;

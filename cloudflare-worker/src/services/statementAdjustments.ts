/** Governed dispute and due-date rules for Revenue (#5039 part 3). */
export type AdjustmentKind = 'record_dispute' | 'set_due_date';
export type AdjustmentRow = {
  status: string; owed_cents: number; paid_cents: number; disputed_cents: number;
  due_on?: string | null;
};

/** A real UTC calendar date; no default terms are inferred for an old statement. */
export function validDueDate(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function adjustmentFigures(row: AdjustmentRow) {
  return {
    status: row.status, owed_cents: row.owed_cents, paid_cents: row.paid_cents,
    disputed_cents: row.disputed_cents, due_on: row.due_on ?? null,
    outstanding_cents: Math.max(0, row.owed_cents - row.paid_cents - row.disputed_cents),
  };
}

export function planAdjustment(kind: AdjustmentKind, row: AdjustmentRow, value: unknown) {
  if (!['draft', 'issued'].includes(row.status)) return { error: 'invalid_status', message: 'Only a draft or issued statement can be adjusted.' };
  if (![row.owed_cents, row.paid_cents, row.disputed_cents].every((v) => Number.isSafeInteger(v) && v >= 0)
      || row.paid_cents + row.disputed_cents > row.owed_cents) {
    return { error: 'figures_unreadable', message: 'The recorded figures cannot be checked. Nothing was written.' };
  }
  if (kind === 'record_dispute') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return { error: 'bad_amount', message: 'disputed_cents must be whole minor units, zero or more.' };
    if (value + row.paid_cents > row.owed_cents) return { error: 'over_owed', message: 'Paid and disputed together cannot exceed owed.' };
    return { before: adjustmentFigures(row), after: adjustmentFigures({ ...row, disputed_cents: value }) };
  }
  if (!validDueDate(value)) return { error: 'bad_due_date', message: 'due_on must be a real YYYY-MM-DD date, or null to clear it.' };
  return { before: adjustmentFigures(row), after: adjustmentFigures({ ...row, due_on: value }) };
}

/** Unknown dates/figures remain unknown; the due day itself is not overdue. */
export function statementOverdue(row: AdjustmentRow, today = new Date().toISOString().slice(0, 10)): boolean | null {
  if (!row.due_on || !validDueDate(row.due_on)) return null;
  const f = [row.owed_cents, row.paid_cents, row.disputed_cents];
  if (!f.every((v) => Number.isSafeInteger(v) && v >= 0)) return null;
  return row.status === 'issued' && row.due_on < today && row.owed_cents > row.paid_cents + row.disputed_cents;
}

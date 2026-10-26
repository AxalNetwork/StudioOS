/** D1175: pure planning assumptions, never a measurement of runway today. */
export const SECTION_KEYS = ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve'] as const;
export type SectionKey = typeof SECTION_KEYS[number];
export type Source = 'Typed' | 'Connector' | 'Document' | 'Signed' | 'Modelled' | 'Recorded';
export type Fact<T> = { value: T | null; source: Source; ref?: string; asOf?: string };
export const MODEL_V1 = Object.freeze({
  version: 1 as const,
  label: 'Modelled' as const,
  allocation: 'Whole cents; largest remainder, fixed section order breaks ties',
  payroll: 'Annual cost / 12, cumulative whole-cent rounding; recurring from start month',
  remainder: 'Allocation less payroll during the target; spread evenly over target months',
  overBudget: 'Payroll is retained when it exceeds its allocation; remainder is zero',
  cash: 'Opening cash plus the raise only in its recorded arrival month, minus planned spend',
  horizon: 'No revenue, unrecorded cash inflows or extrapolation beyond the supplied horizon',
});
export type PlanInputs = {
  startMonth: string | null;
  horizonMonths: number | null;
  targetMonths: number | null;
  currency: string;
  raiseCents: Fact<number>;
  cashCents: Fact<number>;
  raiseMonth: string | null;
  lines: { key: SectionKey; sharePct: Fact<number> }[] | null;
  // null is an unread/absent list; [] is a successfully recorded empty list.
  hires: { id: string; key: SectionKey; startMonth: string | null; annualCents: Fact<number>; currency: string }[] | null;
  milestones: { id: string; key: SectionKey | null; costCents: Fact<number>; dueMonth: string | null }[] | null;
};
export type Modelled<T> = {
  source: 'Modelled'; modelVersion: 1; state: 'recorded' | 'not_recorded';
  value: T | null; reason: string | null; inputs: PlanInputs;
};
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const duration = (v: unknown): v is number => whole(v) && v >= 1 && v <= 120;
function month(value: string | null): number | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
}
function monthName(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}
const safe = (v: bigint): number | null => v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(v);
function payroll(annual: number, n: number): number | null {
  return safe((BigInt(annual) * BigInt(n) + 6n) / 12n);
}

/** All missing/invalid inputs stay missing; this function reads no clock, DB or provider. */
export function plan(input: PlanInputs) {
  const inputs = structuredClone(input);
  const result = <T>(value: T | null, reason: string | null = null): Modelled<T> => ({
    source: 'Modelled', modelVersion: 1, state: value === null ? 'not_recorded' : 'recorded', value, reason, inputs,
  });
  const start = month(inputs.startMonth);
  const horizon = duration(inputs.horizonMonths) ? inputs.horizonMonths : null;
  const target = duration(inputs.targetMonths) ? inputs.targetMonths : null;
  const shares = SECTION_KEYS.map(key => inputs.lines?.filter(l => l.key === key) ?? []);
  const validShares = inputs.lines?.length === 5 && shares.every(a => a.length === 1 && whole(a[0].sharePct.value) && a[0].sharePct.value <= 100)
    && shares.reduce((sum, a) => sum + (a[0].sharePct.value as number), 0) === 100;
  let budgets: number[] | null = null;
  if (whole(inputs.raiseCents.value) && validShares) {
    const numerators = shares.map(a => BigInt(inputs.raiseCents.value!) * BigInt(a[0].sharePct.value!));
    budgets = numerators.map(n => Number(n / 100n));
    const order = numerators.map((n, i) => ({ i, remainder: Number(n % 100n) })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
    const left = inputs.raiseCents.value - budgets.reduce((a, b) => a + b, 0);
    for (let i = 0; i < left; i++) budgets[order[i].i]++;
  }
  const scheduleReason = budgets === null ? 'Raise amount or a complete split totalling 100% is Not recorded.'
    : start === null || target === null || horizon === null ? 'Plan start, target or horizon is Not recorded.'
      : inputs.hires === null ? 'Planned hires have not been read.' : null;
  const unknownHireKey = inputs.hires?.some(h => !SECTION_KEYS.includes(h.key));
  const sections = SECTION_KEYS.map((key, index) => {
    const allocation = result(budgets?.[index] ?? null, budgets === null ? 'Raise amount or complete split is Not recorded.' : null);
    const hires = inputs.hires?.filter(h => h.key === key) ?? [];
    const missingHire = unknownHireKey || hires.some(h => month(h.startMonth) === null || !whole(h.annualCents.value) || h.currency !== inputs.currency);
    if (scheduleReason || missingHire) return {
      key, allocation, payroll: result<number[]>(null, scheduleReason ?? 'A hire start, cost or matching currency is Not recorded.'),
      spend: result<number[]>(null, scheduleReason ?? 'A hire start, cost or matching currency is Not recorded.'), overBudget: result<boolean>(null, scheduleReason ?? 'Hire inputs are incomplete.'),
    };
    const salaryAt = (offset: number) => {
      let total = 0n;
      for (const hire of hires) {
        const hireStart = month(hire.startMonth)!;
        const activeBefore = Math.max(0, start! + offset - hireStart);
        const before = payroll(hire.annualCents.value!, activeBefore);
        const after = payroll(hire.annualCents.value!, Math.max(0, start! + offset + 1 - hireStart));
        if (before === null || after === null) return null;
        total += BigInt(after - before);
      }
      return safe(total);
    };
    const targetPayroll = Array.from({ length: target! }, (_, i) => salaryAt(i));
    const wages = Array.from({ length: horizon! }, (_, i) => salaryAt(i));
    const salaryTotal = targetPayroll.some(n => n === null) ? null : safe(targetPayroll.reduce<bigint>((a, n) => a + BigInt(n!), 0n));
    if (salaryTotal === null || wages.some(n => n === null)) return {
      key, allocation, payroll: result<number[]>(null, 'Planned payroll exceeds safe whole-cent precision.'),
      spend: result<number[]>(null, 'Planned payroll exceeds safe whole-cent precision.'), overBudget: result<boolean>(null, 'Planned payroll exceeds safe whole-cent precision.'),
    };
    const remainder = Math.max(0, budgets![index] - salaryTotal);
    const spend = wages.map((w, i) => safe(BigInt(w!) + BigInt(i < target! ? Math.floor(remainder / target!) + (i < remainder % target! ? 1 : 0) : 0)));
    return { key, allocation, payroll: result(wages as number[]), spend: result(spend.some(n => n === null) ? null : spend as number[], spend.some(n => n === null) ? 'Planned spend exceeds safe whole-cent precision.' : null), overBudget: result(salaryTotal > budgets![index]) };
  });
  const monthly = sections.every(s => s.spend.value !== null) && horizon !== null
    ? Array.from({ length: horizon }, (_, i) => safe(sections.reduce((sum, s) => sum + BigInt(s.spend.value![i]), 0n))) : null;
  const burnValues = monthly && monthly.every(n => n !== null) ? monthly as number[] : null;
  const burn = result(burnValues?.map((spendCents, i) => ({ month: monthName(start! + i), spendCents })) ?? null,
    burnValues === null ? 'Planned burn is Not recorded because plan inputs are incomplete or exceed whole-cent precision.' : null);
  const spendTotal = burnValues ? safe(burnValues.reduce((a, n) => a + BigInt(n), 0n)) : null;
  const spend = result(spendTotal, spendTotal === null ? 'Planned spend is Not recorded because plan inputs are incomplete or exceed whole-cent precision.' : null);
  const arrival = month(inputs.raiseMonth);
  const timingKnown = inputs.raiseCents.value === 0 || (arrival !== null && start !== null && arrival >= start);
  const cashKnown = typeof inputs.cashCents.value === 'number' && Number.isSafeInteger(inputs.cashCents.value) && whole(inputs.raiseCents.value) && timingKnown && burnValues !== null;
  const points: { month: string; openingCents: number; raisedCents: number; spendCents: number; closingCents: number }[] = [];
  let cash = inputs.cashCents.value;
  let cashOutMonths: number | null = cashKnown && cash! <= 0 ? 0 : null;
  if (cashKnown) {
    for (let i = 0; i < horizon!; i++) {
      const raisedCents = arrival === start! + i ? inputs.raiseCents.value! : 0;
      const available = safe(BigInt(cash!) + BigInt(raisedCents));
      const closing = available === null ? null : safe(BigInt(available) - BigInt(burnValues![i]));
      if (closing === null) { points.length = 0; break; }
      // A month-zero receipt can fund an opening balance of zero.
      if (i === 0 && raisedCents > 0) cashOutMonths = null;
      if (cashOutMonths === null && closing <= 0) cashOutMonths = i + (burnValues![i] > 0 ? Math.max(0, available!) / burnValues![i] : 0);
      points.push({ month: monthName(start! + i), openingCents: cash!, raisedCents, spendCents: burnValues![i], closingCents: closing });
      cash = closing;
    }
  }
  const path = points.length === horizon ? points : null;
  const cashPath = result(path, path === null ? 'Opening cash, raise timing or the planned burn is Not recorded, or exceeds whole-cent precision.' : null);
  const cashOut = result(path === null ? null : { months: cashOutMonths, withinHorizon: cashOutMonths !== null }, path === null ? cashPath.reason : null);
  const runway = result(path === null ? null : { months: cashOutMonths ?? horizon!, relation: cashOutMonths === null ? 'at_least' as const : 'exact' as const }, path === null ? cashPath.reason : null);
  const remaining = budgets?.slice();
  // Each milestone consumes its section's budget once, in deadline/id order.
  const milestones = inputs.milestones === null ? null : [...inputs.milestones].sort((a, b) => (a.dueMonth ?? '9999-12').localeCompare(b.dueMonth ?? '9999-12') || a.id.localeCompare(b.id)).map(m => {
    const i = m.key === null ? -1 : SECTION_KEYS.indexOf(m.key);
    const cost = m.costCents.value;
    const costed = whole(cost);
    const known = costed && remaining !== undefined && i >= 0;
    const funded = known ? cost <= remaining![i] : null;
    if (funded) remaining![i] -= cost!;
    const due = month(m.dueMonth);
    const dueOffset = due === null || start === null ? null : due - start + 1;
    const reachKnown = funded !== null && path !== null && dueOffset !== null && dueOffset > 0 && dueOffset <= horizon!;
    return {
      id: m.id, state: cost === null ? 'Not costed' : !known ? 'Not recorded' : funded ? 'Funded' : 'At risk',
      funded: result(funded, funded === null ? !costed ? 'Milestone cost is Not costed.' : 'Section allocation is Not recorded.' : null),
      reached: result(reachKnown ? funded && (cashOutMonths === null || dueOffset! <= cashOutMonths) : null, reachKnown ? null : 'Milestone date or cash through that date is Not recorded within the model horizon.'),
    };
  });
  return { model: MODEL_V1, sections, spend, burn, cashPath, cashOut, runway, milestones: result(milestones, milestones === null ? 'Milestones have not been read.' : null) };
}

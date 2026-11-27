/**
 * Read-only investor Carta projection (#2634). Published v1alpha1 response
 * schemas verified 2026-10-23 at https://docs.carta.com/api-platform/reference/ .
 * One page per request, provider page tokens only; never follow returned URLs.
 * Names are organization/security labels, never stakeholder names or emails.
 * No provider response is persisted or logged. Missing figures stay null.
 */
export type CartaRead = (path: string) => Promise<Response>;
export type CartaResource = 'firms' | 'funds' | 'investments' | 'certificates' | 'convertibleNotes' | 'warrants' | 'capitalizationTables' | 'capitalizationTable';
export class CartaReadError extends Error {
  status: number;
  constructor(status: number) { super('carta_unreadable'); this.status = status; }
}
const str = (v: unknown, max = 1000): string | null => typeof v === 'string' && v.length <= max ? v : null;
const id = (v: unknown) => str(v, 50);
const obj = (v: any): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const date = (v: any): string | null => /^\d{4}-\d{2}-\d{2}$/.test(obj(v).value) ? obj(v).value : null;
const decimal = (v: any): string | null => {
  const x = str(obj(v).value, 100);
  return x !== null && /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(x) ? x : null;
};
const money = (v: any) => {
  const x = obj(v), currency = obj(x.currencyCode).value, amount = decimal(x.amount);
  return amount !== null && /^[A-Z]{3}$/.test(currency) ? { amount, currency } : null;
};
export const cartaIdValid = (v: string) => /^[A-Za-z0-9_-]{1,50}$/.test(v) && v !== '-';
export const cartaPageValid = (v: string) => /^[A-Za-z0-9_+/=-]{1,4096}$/.test(v);

function summary(v: any) {
  const x = obj(v);
  return { fully_diluted_shares: decimal(x.fullyDilutedShares), outstanding_shares: decimal(x.outstandingShares),
    cash_raised: money(x.cashRaised), company_fully_diluted_shares: decimal(x.companyFullyDilutedShares), company_outstanding_shares: decimal(x.companyOutstandingShares) };
}
function capTable(v: any) {
  const x = obj(v);
  if (x.shareClassDetails !== undefined && (!Array.isArray(x.shareClassDetails) || x.shareClassDetails.length > 1000)) throw new CartaReadError(502);
  return { id: id(x.id), firm_id: id(x.firmId), fund_id: id(x.fundId), company_id: id(x.companyId), as_of: date(x.asOfDate),
    summary: summary(x.summary), share_classes: Array.isArray(x.shareClassDetails) ? x.shareClassDetails.map((item: any) => {
      const s = obj(item.shareClass);
      return { id: id(s.id), name: str(s.name), type: str(s.type, 100), ...summary(item.summary) };
    }) : null };
}
function project(resource: CartaResource, v: any): Record<string, unknown> {
  const x = obj(v);
  if (resource === 'firms') return { id: id(x.id), name: str(x.name) };
  if (resource === 'funds') return { id: id(x.id), firm_id: id(x.firmId), name: str(x.name) };
  if (resource === 'investments') return { company_id: id(x.companyId), firm_id: id(x.firmId), fund_id: id(x.fundId),
    legal_name: str(x.legalName), display_name: str(x.doingBusinessAsName), reference_cap_table_id: id(x.referenceCapTableId) };
  if (resource === 'capitalizationTables') return { id: id(x.id), firm_id: id(x.firmId), fund_id: id(x.fundId), company_id: id(x.companyId),
    name: str(x.name), type: str(x.type, 100), as_of: date(x.asOfDate) };
  if (resource === 'capitalizationTable') return capTable(x);
  const common = { id: id(x.id), firm_id: id(x.firmId), fund_id: id(x.fundId), company_id: id(x.companyId), label: str(x.securityLabel, 50),
    issued_on: date(x.issueDate), canceled_on: date(x.canceledDate) };
  if (resource === 'convertibleNotes') return { ...common, type: 'convertible_note', cash_paid: money(x.cashPaid), maturity_date: date(x.maturityDate),
    interest: money(x.interest), interest_rate: decimal(x.interestRate), price_cap: money(x.priceCap), discount_percentage: decimal(x.discountPercentage),
    converted_on: date(x.conversionDate), note_type: str(obj(x.noteBlock).noteType, 100) };
  return { ...common, type: resource === 'warrants' ? 'warrant' : 'certificate', share_class: str(resource === 'warrants' ? obj(x.warrantBlock).shareClassName : x.shareClassName),
    quantity: decimal(x.quantity), price_per_share: money(x.pricePerShare),
    ...(resource === 'warrants' ? { exercise_price: money(obj(x.warrantBlock).exercisePrice) } : { terminated_on: date(x.terminationDate) }) };
}

async function boundedJson(response: Response): Promise<Record<string, any>> {
  if (!response.ok) throw new CartaReadError(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new CartaReadError(502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new CartaReadError(502); }
      chunks.push(value);
    }
    const all = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const out = JSON.parse(new TextDecoder().decode(all));
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new CartaReadError(502);
    return out;
  } catch { throw new CartaReadError(502); } finally { reader.releaseLock(); }
}

/** The path is built by our route, never a provider response or a caller's URL. */
export async function readCartaInvestor(read: CartaRead, path: string, resource: CartaResource, pageToken?: string) {
  const query = resource === 'capitalizationTable' ? '' : `?pageSize=25${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
  const data = await boundedJson(await read(path + query));
  if (resource === 'capitalizationTable') {
    if (!data.capitalizationTable || typeof data.capitalizationTable !== 'object' || Array.isArray(data.capitalizationTable)) throw new CartaReadError(502);
    return { capitalization_table: project(resource, data.capitalizationTable) };
  }
  // Protobuf JSON may omit an empty repeated field. A malformed field is unreadable.
  const items = data[resource] ?? [];
  if (!Array.isArray(items) || items.length > 1000 || items.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new CartaReadError(502);
  const next = data.nextPageToken || null;
  if (next !== null && (typeof next !== 'string' || !cartaPageValid(next))) throw new CartaReadError(502);
  return { items: items.map(x => project(resource, x)), next_page_token: next,
    ...(resource === 'investments' ? { coverage: 'Carta returns only investments with cap-table data on Carta. Other investments are not recorded here.' } : {}) };
}

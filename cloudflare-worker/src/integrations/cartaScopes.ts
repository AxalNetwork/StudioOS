/** Carta grants belong to one audience; never combine issuer and investor scopes (#2634). */
export const CARTA_FOUNDER_SCOPES = ['read_issuer_info', 'read_issuer_stakeholders', 'read_issuer_securities'] as const;
export const CARTA_INVESTOR_SCOPES = ['read_investor_firms', 'read_investor_funds', 'read_investor_investments', 'read_investor_securities', 'read_investor_capitalizationtables'] as const;
export type CartaAudience = 'founder' | 'investor';
export function cartaAudience(role: string | null | undefined): CartaAudience | null {
  return role === 'founder' || role === 'investor' ? role : null;
}
export function cartaScopesFor(audience: CartaAudience): string[] {
  return [...(audience === 'investor' ? CARTA_INVESTOR_SCOPES : CARTA_FOUNDER_SCOPES)];
}
export function cartaExtraScopes(audience: CartaAudience, granted: readonly string[]): string[] {
  const allowed = new Set(cartaScopesFor(audience));
  return granted.filter(scope => !allowed.has(scope));
}

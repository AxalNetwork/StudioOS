/** D629: authoritative checkout quote and payment-webhook-only credit. */
import type { Env } from '../types';
import { AI_USD_SCALE } from './aiBudget';

export function aiTopupPriceId(env:Env):string|null {
  const value=(env as any).STRIPE_PRICE_AI_TOPUP;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^price_[A-Za-z0-9]+$/.test(value)) throw new Error('AI top-up configuration unreadable');
  return value;
}
/**
 * D750 (#1841) — why a configured top-up price cannot be sold. A configuration
 * problem is never "could not be read": each is a state with its reason, and
 * only a D1 or Stripe read that fails throws.
 */
export type AiTopupNotReady = 'missing_from_catalog'|'inactive'|'not_one_time'|'not_usd'|'bad_amount'|'bad_config'|'mode_mismatch';
export type AiTopupProduct = {price_id:string;product_id:string;name:string;currency:'usd';unit_amount:number;cycle:'onetime';credit_microusd:number};
export type AiTopupReading =
  | {configured:false}
  | {configured:true;state:'ready';product:AiTopupProduct}
  | {configured:true;state:'not_ready';reason:AiTopupNotReady};

/** A price the mirror lacks is asked of Stripe at most once per this window, per isolate (decision 2). */
export const MIRROR_FETCH_WINDOW_MS = 10*60*1000;
const lastMirrorFetch = new Map<string,number>();
/** Tests only: forget the window, as a fresh isolate does. */
export function resetAiTopupMirrorWindow():void { lastMirrorFetch.clear(); }

/** D750's rule for a sellable price; D755's packOnSale reuses it (services/aiCredits.ts). */
export function judge(id:string,found:{product:{id:string;name:string;active:boolean};price:{active:boolean;type:string;currency:string;unit_amount:number|null}}):AiTopupReading {
  if (!found.product.active || !found.price.active) return {configured:true,state:'not_ready',reason:'inactive'};
  if (found.price.type !== 'one_time') return {configured:true,state:'not_ready',reason:'not_one_time'};
  if (found.price.currency !== 'usd') return {configured:true,state:'not_ready',reason:'not_usd'};
  const amount=found.price.unit_amount;
  if (!Number.isSafeInteger(amount) || Number(amount)<=0 || !Number.isSafeInteger(Number(amount)*10000)) return {configured:true,state:'not_ready',reason:'bad_amount'};
  return {configured:true,state:'ready',product:{price_id:id,product_id:found.product.id,name:found.product.name,
    currency:'usd',unit_amount:amount as number,cycle:'onetime',credit_microusd:(amount as number)*10000}};
}

export async function readAiTopupProduct(env:Env, now:number=Date.now()):Promise<AiTopupReading> {
  const raw=(env as any).STRIPE_PRICE_AI_TOPUP;
  if (raw === undefined || raw === null || raw === '') return {configured:false};
  if (typeof raw !== 'string' || !/^price_[A-Za-z0-9]+$/.test(raw)) return {configured:true,state:'not_ready',reason:'bad_config'};
  const id=raw;
  const {findCatalogProductByPriceId,fetchAndMirrorPrice}=await import('./catalog');
  const found=await findCatalogProductByPriceId(env,id);
  if (found) return judge(id,found);
  // Not in the mirror: ask Stripe for this one price, once per window (decision 2).
  const last=lastMirrorFetch.get(id);
  if (last !== undefined && now-last < MIRROR_FETCH_WINDOW_MS) return {configured:true,state:'not_ready',reason:'missing_from_catalog'};
  lastMirrorFetch.set(id,now);
  const fetched=await fetchAndMirrorPrice(env,id);
  if (fetched.state !== 'mirrored') return {configured:true,state:'not_ready',reason:fetched.state==='mode_mismatch'?'mode_mismatch':'missing_from_catalog'};
  return judge(id,fetched);
}

/** What a member is told: the state, never the reason (decision 3). */
export function memberTopupReading(r:AiTopupReading) {
  if (!r.configured) return {configured:false as const};
  return r.state === 'ready' ? {configured:true as const,state:'ready' as const,product:r.product} : {configured:true as const,state:'not_ready' as const};
}

/**
 * HQ's readiness line (decision 4): the state, the reason, the last six
 * characters of the price ID and the Stripe mode. Never a key, and no part of a
 * malformed value, which could be a key pasted into the wrong secret.
 */
export async function aiTopupStatus(env:Env) {
  const {stripeMode}=await import('./catalog');
  const r=await readAiTopupProduct(env);
  const raw=(env as any).STRIPE_PRICE_AI_TOPUP;
  const wellFormed=typeof raw==='string' && /^price_[A-Za-z0-9]+$/.test(raw);
  return {
    state: !r.configured ? 'unset' as const : r.state,
    reason: r.configured && r.state==='not_ready' ? r.reason : null,
    price_id_suffix: wellFormed ? raw.slice(-6) : null,
    mode: stripeMode(env),
  };
}
/** D755: a pack's quote, from tokenPackQuote (services/aiCredits.ts). A pack is never discounted. */
export type AiTopupQuote = {priceId:string;creditMicrousd:number;packUid?:string|null;bonusMicrousd?:number;firstPurchaseOnly?:boolean};
export async function recordAiTopupPurchase(env:Env,input:{paymentIntentId:string;orderRef:string;userId:number;totalCents:number;currency:string;quote:AiTopupQuote|null}) {
  if (!input.quote) return;
  if (!/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId) || !Number.isSafeInteger(input.totalCents) || input.totalCents<=0 || input.currency !== 'usd') throw new Error('AI top-up payment unreadable');
  const packUid=input.quote.packUid ?? null, bonus=input.quote.bonusMicrousd ?? 0, first=input.quote.firstPurchaseOnly ? 1 : 0;
  if (!Number.isSafeInteger(bonus) || bonus<0) throw new Error('AI top-up payment unreadable');
  // D790: first_purchase_only is fixed here with the bonus, so the webhook follows the order paid.
  const result=await env.DB.prepare(`INSERT OR IGNORE INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,bonus_microusd,first_purchase_only)
    VALUES(?,?,?,?,?,?,'usd',?,?,?)`).bind(input.paymentIntentId,input.orderRef,input.userId,input.quote.priceId,input.quote.creditMicrousd,input.totalCents,packUid,bonus,first).run();
  if (result.success !== true) throw new Error('AI top-up purchase unreadable');
  const row=await env.DB.prepare('SELECT * FROM ai_topup_purchases WHERE payment_intent_id=?').bind(input.paymentIntentId).first<any>();
  if (!row || row.order_ref!==input.orderRef || row.user_id!==input.userId || row.price_id!==input.quote.priceId || row.credit_microusd!==input.quote.creditMicrousd || row.expected_total_cents!==input.totalCents
    || row.pack_uid!==packUid || row.bonus_microusd!==bonus || row.first_purchase_only!==first) throw new Error('AI top-up quote changed');
}
/** Called only from the verified payment_intent.succeeded webhook, never fulfilOrder or /confirm. */
export async function creditAiTopupFromPayment(env:Env,pi:any):Promise<boolean> {
  const meta=pi.metadata || {};
  if (meta.kind !== 'cart_order' || typeof pi.id !== 'string') return false;
  const row=await env.DB.prepare('SELECT * FROM ai_topup_purchases WHERE payment_intent_id=?').bind(pi.id).first<any>();
  if (!row) return false; // Ordinary orders do not buy AI credit.
  // The legacy local/dev webhook may soft-accept without a secret. It cannot mint paid AI balance.
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('AI top-up webhook is not configured');
  if (pi.status !== 'succeeded' || pi.currency !== row.currency || pi.amount_received !== row.expected_total_cents
    || meta.order_ref !== row.order_ref || Number(meta.user_id)!==row.user_id) throw new Error('AI top-up payment does not match its quote');
  // D755: the purchase and its bonus go to ai_credit_ledger, written only when the purchase row is new.
  // No ai_topup_ledger row: that would fire migration 486's mirror trigger.
  const uid=crypto.randomUUID();
  // D790 (#2215): a first-purchase pack paid after the member's first credited pack (two checkouts racing)
  // is credited at the face value paid, without its bonus. The withheld bonus is moved off bonus_microusd
  // before anything is credited, so the credit, the balance and any later reversal share read the same row.
  // It runs first and only while this purchase is uncredited, so any purchase on the ledger is another one.
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE ai_topup_purchases SET bonus_withheld_microusd=bonus_microusd,bonus_microusd=0,updated_at=datetime('now')
      WHERE payment_intent_id=? AND credited_at IS NULL AND first_purchase_only=1 AND bonus_microusd>0
        AND EXISTS(SELECT 1 FROM ai_credit_ledger l WHERE l.user_id=ai_topup_purchases.user_id AND l.kind='purchase')`).bind(pi.id),
    env.DB.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id) VALUES(?)').bind(row.user_id),
    env.DB.prepare(`INSERT OR IGNORE INTO ai_credit_ledger(uid,user_id,kind,delta_microusd,source_ref,payment_intent_id,pack_uid,actor)
      SELECT ?,user_id,'purchase',credit_microusd,'pi:'||payment_intent_id,payment_intent_id,pack_uid,'payment_webhook' FROM ai_topup_purchases
      WHERE payment_intent_id=? AND credited_at IS NULL`).bind(uid,pi.id),
    env.DB.prepare(`INSERT OR IGNORE INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,payment_intent_id,pack_uid,actor)
      SELECT user_id,'bonus',bonus_microusd,'pi:'||payment_intent_id,payment_intent_id,pack_uid,'payment_webhook' FROM ai_topup_purchases
      WHERE payment_intent_id=? AND bonus_microusd>0 AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid=?)`).bind(pi.id,uid),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd=balance_microusd+(SELECT credit_microusd+bonus_microusd FROM ai_topup_purchases WHERE payment_intent_id=?),updated_at=datetime('now')
      WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid=?)`).bind(pi.id,row.user_id,uid),
    env.DB.prepare(`UPDATE ai_topup_purchases SET credited_at=datetime('now'),updated_at=datetime('now')
      WHERE payment_intent_id=? AND credited_at IS NULL AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid=?)`).bind(pi.id,uid),
    env.DB.prepare(`INSERT INTO activity_logs(action,details,actor,user_id)
      SELECT 'ai_topup_credited',json_object('payment_intent_id',payment_intent_id,'order_ref',order_ref,'credit_microusd',credit_microusd,
        'bonus_microusd',bonus_microusd,'pack_uid',pack_uid),'payment_webhook',user_id FROM ai_topup_purchases
      WHERE payment_intent_id=? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid=?)`).bind(pi.id,uid),
    env.DB.prepare(`INSERT INTO activity_logs(action,details,actor,user_id)
      SELECT 'ai_topup_bonus_withheld',json_object('payment_intent_id',payment_intent_id,'order_ref',order_ref,'bonus_withheld_microusd',bonus_withheld_microusd,
        'pack_uid',pack_uid,'reason','first_purchase_only'),'payment_webhook',user_id FROM ai_topup_purchases
      WHERE payment_intent_id=? AND bonus_withheld_microusd>0 AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid=?)`).bind(pi.id,uid),
  ]);
  if (results.length!==8 || results.some(r=>r.success!==true)) throw new Error('AI token top-up unreadable');
  const credited=Number(results[2].meta.changes)>0;
  if (credited) {
    const paid=await env.DB.prepare('SELECT credit_microusd,bonus_microusd FROM ai_topup_purchases WHERE payment_intent_id=?').bind(pi.id).first<any>();
    if (paid) { row.credit_microusd=paid.credit_microusd; row.bonus_microusd=paid.bonus_microusd; }
    // Best-effort, once: only the delivery that wrote the purchase row sends it.
    try {
      const {notify}=await import('./notify');
      const added=`$${((row.credit_microusd+row.bonus_microusd)/AI_USD_SCALE).toFixed(2)}`;
      await notify(env,{userId:row.user_id,type:'ai_tokens_added',category:'billing',title:`Tokens added: ${added}`,
        body:`${added} was added to your AI top-up balance.`,link:'/account/usage#top-ups',
        payload:{payment_intent_id:pi.id,pack_uid:row.pack_uid},channels:['in_app']});
    } catch { /* best-effort */ }
  }
  return credited;
}

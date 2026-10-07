/** D629: authoritative checkout quote and payment-webhook-only credit. */
import type { Env } from '../types';
import { AI_USD_SCALE } from './aiBudget';
import type { PricedCart } from './orders';

export function aiTopupPriceId(env:Env):string|null {
  const value=(env as any).STRIPE_PRICE_AI_TOPUP;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^price_[A-Za-z0-9]+$/.test(value)) throw new Error('AI top-up configuration unreadable');
  return value;
}
export async function readAiTopupProduct(env:Env) {
  const id=aiTopupPriceId(env);
  if (!id) return {configured:false as const,product:null};
  const {findCatalogProductByPriceId}=await import('./catalog');
  const found=await findCatalogProductByPriceId(env,id);
  if (!found || !found.product.active || !found.price.active || found.price.type !== 'one_time' || found.price.currency !== 'usd'
    || !Number.isSafeInteger(found.price.unit_amount) || Number(found.price.unit_amount)<=0
    || !Number.isSafeInteger(Number(found.price.unit_amount)*10000)) throw new Error('AI top-up product unreadable');
  return {configured:true as const,product:{price_id:id,product_id:found.product.id,name:found.product.name,
    currency:'usd',unit_amount:found.price.unit_amount as number,cycle:'onetime',credit_microusd:(found.price.unit_amount as number)*10000}};
}
/** Discount is allocated proportionally, rounded UP for this line: never over-credit a mixed cart. */
export function aiTopupCreditQuote(env:Env,cart:PricedCart,discountCents:number): {priceId:string;creditMicrousd:number}|null {
  const priceId=aiTopupPriceId(env);
  if (!priceId) return null;
  const lines=cart.lines.filter(l=>l.price_id===priceId);
  if (!lines.length) return null;
  if (cart.currency !== 'usd' || !Number.isSafeInteger(cart.subtotal) || cart.subtotal<=0
    || !Number.isSafeInteger(discountCents) || discountCents<0 || discountCents>cart.subtotal) throw new Error('AI top-up quote unreadable');
  const gross=lines.reduce((n,l)=>n+l.line_total,0);
  if (!Number.isSafeInteger(gross) || gross<0 || gross>cart.subtotal) throw new Error('AI top-up quote unreadable');
  const discount=Number((BigInt(discountCents)*BigInt(gross)+BigInt(cart.subtotal)-1n)/BigInt(cart.subtotal));
  const creditMicrousd=(gross-discount)* (AI_USD_SCALE/100);
  if (!Number.isSafeInteger(creditMicrousd) || creditMicrousd<0) throw new Error('AI top-up quote unreadable');
  return creditMicrousd>0 ? {priceId,creditMicrousd} : null;
}
export async function recordAiTopupPurchase(env:Env,input:{paymentIntentId:string;orderRef:string;userId:number;totalCents:number;currency:string;quote:{priceId:string;creditMicrousd:number}|null}) {
  if (!input.quote) return;
  if (!/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId) || !Number.isSafeInteger(input.totalCents) || input.totalCents<=0 || input.currency !== 'usd') throw new Error('AI top-up payment unreadable');
  const result=await env.DB.prepare(`INSERT OR IGNORE INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency)
    VALUES(?,?,?,?,?,?,'usd')`).bind(input.paymentIntentId,input.orderRef,input.userId,input.quote.priceId,input.quote.creditMicrousd,input.totalCents).run();
  if (result.success !== true) throw new Error('AI top-up purchase unreadable');
  const row=await env.DB.prepare('SELECT * FROM ai_topup_purchases WHERE payment_intent_id=?').bind(input.paymentIntentId).first<any>();
  if (!row || row.order_ref!==input.orderRef || row.user_id!==input.userId || row.price_id!==input.quote.priceId || row.credit_microusd!==input.quote.creditMicrousd || row.expected_total_cents!==input.totalCents) throw new Error('AI top-up quote changed');
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
  const uid=crypto.randomUUID();
  const results=await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id) VALUES(?)').bind(row.user_id),
    env.DB.prepare(`INSERT OR IGNORE INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,payment_intent_id,actor)
      SELECT ?,user_id,'credit',credit_microusd,payment_intent_id,'payment_webhook' FROM ai_topup_purchases
      WHERE payment_intent_id=? AND credited_at IS NULL`).bind(uid,pi.id),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd=balance_microusd+?,updated_at=datetime('now')
      WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_topup_ledger WHERE uid=?)`).bind(row.credit_microusd,row.user_id,uid),
    env.DB.prepare(`UPDATE ai_topup_purchases SET credited_at=datetime('now'),updated_at=datetime('now')
      WHERE payment_intent_id=? AND credited_at IS NULL AND EXISTS(SELECT 1 FROM ai_topup_ledger WHERE payment_intent_id=?)`).bind(pi.id,pi.id),
    env.DB.prepare(`INSERT INTO activity_logs(action,details,actor,user_id)
      SELECT 'ai_topup_credited',?,'payment_webhook',? WHERE EXISTS(SELECT 1 FROM ai_topup_ledger WHERE uid=?)`)
      .bind(JSON.stringify({payment_intent_id:pi.id,order_ref:row.order_ref,credit_microusd:row.credit_microusd}),row.user_id,uid),
  ]);
  if (results.length!==5 || results.some(r=>r.success!==true)) throw new Error('AI top-up credit unreadable');
  return Number(results[1].meta.changes)>0;
}

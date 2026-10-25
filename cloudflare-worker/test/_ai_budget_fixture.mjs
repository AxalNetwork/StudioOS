import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
export const AI_BUDGET_REVIEW_MIGRATION=readFileSync(new URL('../sql/migrations/430_ai_budget_review_cost.sql',import.meta.url),'utf8');
export const AI_CREDITS_MIGRATION=readFileSync(new URL('../sql/migrations/486_ai_credits_token_packs.sql',import.meta.url),'utf8');
// D1010: migration 572 adds the price each subscription is charged at, so the plan migration carries both.
export const AI_PLAN_MIGRATION=readFileSync(new URL('../sql/migrations/505_member_subscription_amounts.sql',import.meta.url),'utf8')
  +readFileSync(new URL('../sql/migrations/572_member_subscription_price_id.sql',import.meta.url),'utf8');
export const AI_PACK_OFFERS_MIGRATION=readFileSync(new URL('../sql/migrations/509_token_pack_offers.sql',import.meta.url),'utf8');
// D788: a member's own monthly spend limit, read by every hold.
export const AI_SPEND_LIMIT_MIGRATION=readFileSync(new URL('../sql/migrations/508_member_ai_spend_limits.sql',import.meta.url),'utf8');
/**
 * D783: a member's allowance is 25% of the plans they pay, and no plan means none.
 * Every fixture user (ids 1 to 1000) pays one $200-a-month plan, so a member's
 * allowance is $50 a month, the old default, and a test about something else
 * keeps its figures. The admin licence ignores plans and keeps the typed caps. Tests about the
 * allowance itself (`ai_allowance_d783.test.ts`) build their own rows.
 */
export const AI_FIXTURE_PLANS=`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000)
 INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,currency,interval,interval_count,status)
 SELECT 'sub_fixture_'||i,i,'founder',20000,'usd','month',1,'active' FROM n;`;
export const AI_BUDGET_MIGRATION=readFileSync(new URL('../sql/migrations/419_ai_caps_topups.sql',import.meta.url),'utf8')+AI_BUDGET_REVIEW_MIGRATION+AI_CREDITS_MIGRATION+AI_PLAN_MIGRATION+AI_SPEND_LIMIT_MIGRATION+AI_PACK_OFFERS_MIGRATION+AI_FIXTURE_PLANS;
export const AI_USERS_SCHEMA=`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,name TEXT,role TEXT,is_active INTEGER DEFAULT 1,
 subscription_tier TEXT DEFAULT 'free',subscription_status TEXT DEFAULT 'active',subscription_renews_at TEXT,
 investor_tier TEXT DEFAULT 'free',investor_subscription_status TEXT DEFAULT 'free',investor_subscription_renews_at TEXT,is_super_admin INTEGER DEFAULT 0);
 INSERT INTO users(id,email,name,role,is_super_admin) VALUES(1,'owner@example.test','Owner','admin',1),(2,'member@example.test','Member','founder',0),(3,'investor@example.test','Investor','investor',0);
 CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY REFERENCES users(id)); INSERT INTO super_admins VALUES(1);
 CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,action TEXT,details TEXT,actor TEXT,user_id INTEGER);`;
export const AI_CHARGED_MIGRATION=readFileSync(new URL('../sql/migrations/493_ai_usage_charged.sql',import.meta.url),'utf8');
export const AI_LOG_SCHEMA=`CREATE TABLE ai_usage_logs(id INTEGER PRIMARY KEY,user_id INTEGER,task TEXT NOT NULL,model TEXT NOT NULL,
 latency_ms INTEGER DEFAULT 0,prompt_tokens INTEGER DEFAULT 0,completion_tokens INTEGER DEFAULT 0,est_cost_usd REAL DEFAULT 0,
 safety_score REAL,fallback_used INTEGER DEFAULT 0,cached INTEGER DEFAULT 0,refusal TEXT,surface TEXT,created_at TEXT DEFAULT(datetime('now')));`+AI_CHARGED_MIGRATION;
export function aiBudgetFixture() {
 const {DB,db}=makeD1('PRAGMA foreign_keys=ON;'+AI_USERS_SCHEMA+AI_LOG_SCHEMA+AI_BUDGET_MIGRATION);
 for(let id=4;id<=100;id++) db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').run(id,`member${id}@example.test`,`Member ${id}`,'founder');
 Object.defineProperty(DB,'_rows',{get:()=>db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all()});
 return {DB,db};
}
/**
 * D783: what typing a member licence's cap did before D783. Every fixture
 * member's monthly allowance becomes `monthlyMicrousd`; 0 removes their plan, so
 * every run uses tokens. Members have no daily cap, so there is no day to set.
 */
export function setFixtureAllowance(db, monthlyMicrousd) {
 if (monthlyMicrousd === 0) { db.exec('DELETE FROM member_subscription_amounts'); return; }
 // 25% of a cent is 2,500 micro-USD. Charging every k months makes any figure exact: cents × 2500 ÷ k = monthlyMicrousd.
 const gcd = (a, b) => (b ? gcd(b, a % b) : a);
 const g = gcd(monthlyMicrousd, 2500);
 db.prepare("UPDATE member_subscription_amounts SET amount_cents = ?, interval = 'month', interval_count = ?").run(monthlyMicrousd / g, 2500 / g);
}

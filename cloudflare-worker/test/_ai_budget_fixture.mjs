import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
export const AI_BUDGET_REVIEW_MIGRATION=readFileSync(new URL('../sql/migrations/430_ai_budget_review_cost.sql',import.meta.url),'utf8');
export const AI_CREDITS_MIGRATION=readFileSync(new URL('../sql/migrations/486_ai_credits_token_packs.sql',import.meta.url),'utf8');
export const AI_BUDGET_MIGRATION=readFileSync(new URL('../sql/migrations/419_ai_caps_topups.sql',import.meta.url),'utf8')+AI_BUDGET_REVIEW_MIGRATION+AI_CREDITS_MIGRATION;
export const AI_USERS_SCHEMA=`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,name TEXT,role TEXT,is_active INTEGER DEFAULT 1,
 subscription_tier TEXT DEFAULT 'free',subscription_status TEXT DEFAULT 'active',subscription_renews_at TEXT,
 investor_tier TEXT DEFAULT 'free',investor_subscription_status TEXT DEFAULT 'free',investor_subscription_renews_at TEXT,is_super_admin INTEGER DEFAULT 0);
 INSERT INTO users(id,email,name,role,is_super_admin) VALUES(1,'owner@example.test','Owner','admin',1),(2,'member@example.test','Member','founder',0),(3,'investor@example.test','Investor','investor',0);
 CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY REFERENCES users(id)); INSERT INTO super_admins VALUES(1);
 CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,action TEXT,details TEXT,actor TEXT,user_id INTEGER);`;
export const AI_LOG_SCHEMA=`CREATE TABLE ai_usage_logs(id INTEGER PRIMARY KEY,user_id INTEGER,task TEXT NOT NULL,model TEXT NOT NULL,
 latency_ms INTEGER DEFAULT 0,prompt_tokens INTEGER DEFAULT 0,completion_tokens INTEGER DEFAULT 0,est_cost_usd REAL DEFAULT 0,
 safety_score REAL,fallback_used INTEGER DEFAULT 0,cached INTEGER DEFAULT 0,refusal TEXT,surface TEXT,created_at TEXT DEFAULT(datetime('now')));`;
export function aiBudgetFixture() {
 const {DB,db}=makeD1('PRAGMA foreign_keys=ON;'+AI_USERS_SCHEMA+AI_LOG_SCHEMA+AI_BUDGET_MIGRATION);
 for(let id=4;id<=100;id++) db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').run(id,`member${id}@example.test`,`Member ${id}`,'founder');
 Object.defineProperty(DB,'_rows',{get:()=>db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all()});
 return {DB,db};
}

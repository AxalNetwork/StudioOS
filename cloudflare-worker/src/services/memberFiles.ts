/** D1168: profile-file metadata, written with the authoritative file key. */
import type { Env } from '../types';
export type MemberFileKind = 'headshot' | 'brand_logo';
export function memberFileStatement(env: Env, key: string, owner: number, kind: MemberFileKind, size: number) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('file_size_invalid');
  return env.DB.prepare(`INSERT INTO member_files (uid,r2_key,owner_user_id,kind,size_bytes)
    VALUES (?,?,?,?,?) ON CONFLICT(r2_key) DO UPDATE SET owner_user_id=excluded.owner_user_id,
    kind=excluded.kind,size_bytes=excluded.size_bytes,size_missing_at=NULL,size_recheck_required=0,updated_at=datetime('now')`)
    .bind(crypto.randomUUID(),key,owner,kind,size);
}
/** Call only after the existing replacement cleanup confirms deletion. No R2 operation here. */
export function missingMemberFileStatement(env: Env, key: string, owner: number) {
  return env.DB.prepare(`UPDATE member_files SET size_bytes=NULL,size_missing_at=datetime('now'),updated_at=datetime('now')
    WHERE r2_key=? AND owner_user_id=?`).bind(key,owner);
}

/** Invalidate a replaced headshot atomically with the new pointer, before R2 cleanup. */
export function recheckMemberFileStatement(env:Env,key:string|null,owner:number,newKey:string){
  return env.DB.prepare(`UPDATE member_files SET size_bytes=NULL,size_missing_at=NULL,size_recheck_required=1,updated_at=datetime('now')
    WHERE r2_key=? AND owner_user_id=? AND r2_key<>? AND kind='headshot'`).bind(key,owner,newKey);
}

import postgres from 'postgres';
import type { Env } from './types';

export function getSQL(env: Env) {
  return postgres(env.DB.connectionString, { ssl: 'require' });
}

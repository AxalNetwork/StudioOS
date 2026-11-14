import type { Env } from './types';

type D1QueryResult = any[];

interface D1Helper {
  (strings: TemplateStringsArray, ...values: any[]): Promise<D1QueryResult>;
  end: () => Promise<void>;
  unsafe: (sql: string, params?: any[]) => Promise<D1QueryResult>;
}

export function getSQL(env: Env): D1Helper {
  const db = env.DB;

  const tag = async function (strings: TemplateStringsArray, ...values: any[]): Promise<D1QueryResult> {
    let sql = '';
    strings.forEach((str, i) => {
      sql += str;
      if (i < values.length) sql += '?';
    });
    const result = await db.prepare(sql).bind(...values).all();
    return (result.results ?? []) as D1QueryResult;
  } as D1Helper;

  tag.end = async () => {};

  tag.unsafe = async (sql: string, params: any[] = []) => {
    const result = await db.prepare(sql).bind(...params).all();
    return (result.results ?? []) as D1QueryResult;
  };

  return tag;
}

import { env } from 'cloudflare:workers';
export type Bindings={DB:D1Database;MONAD_RPC_URL?:string;ARENA_ADDRESS?:string;RELAYER_PRIVATE_KEY?:string;LIVE_ENABLED?:string;PUBLIC_ORIGIN?:string;ENVIO_GRAPHQL_URL?:string;KEEPER_TOKEN?:string};
export function bindings(){return env as unknown as Bindings}
export function db(){const d=bindings().DB;if(!d)throw new Error('Database not configured');return d}
export async function one<T=Record<string,unknown>>(sql:string,...args:unknown[]){return db().prepare(sql).bind(...args).first<T>()}
export async function all<T=Record<string,unknown>>(sql:string,...args:unknown[]){return (await db().prepare(sql).bind(...args).all<T>()).results}

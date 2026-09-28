export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';
export const SESSION_TOPUP = process.env.NEXT_PUBLIC_SESSION_TOPUP ?? '0.3';

import { fallback, http, type HttpTransportConfig } from 'viem';

/** Ordered failover without background probes; try the backup before retrying. */
export function rpcTransport(primary: string, backup?: string, config: HttpTransportConfig = {}) {
  if (!backup || backup === primary) return http(primary, config);
  return fallback([
    http(primary, { ...config, retryCount: 0 }),
    http(backup, { ...config, retryCount: 0 }),
  ], { rank: false, retryCount: 1, retryDelay: 250 });
}

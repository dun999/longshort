import { createWalletClient, encodeFunctionData, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ADDR, REAL_TRADING, activeChain, erc20Abi } from '@longshort/shared';
import { AUSDClaims } from './claims';
import { db } from './db';
import { env } from './env';
import { pub } from './chain';
import { rpcTransport } from './rpc';

let service: AUSDClaims | undefined;
export function ausdClaims() {
  if (!REAL_TRADING || activeChain.id !== 10143 || ADDR.stake.toLowerCase() !== '0xa9012a055bd4e0edff8ce09f960291c09d5322dc')
    throw new Error('AUSD claims are Monad testnet only');
  if (!env.faucetKey) throw new Error('AUSD funding is not configured');
  if (!service) {
    const account = privateKeyToAccount(env.faucetKey);
    const wallet = createWalletClient({ account, chain: activeChain, transport: rpcTransport(env.rpcUrl, env.rpcBackupUrl) });
    service = new AUSDClaims(db, {
      chainId: () => pub.getChainId(),
      balance: (address) => pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
      async prepare(address, amount) {
        if (address.toLowerCase() === account.address.toLowerCase()) throw new Error('This is the funding wallet');
        const available = await pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
        if (available < amount) throw new Error('AUSD faucet is empty. Try again after it is refilled.');
        // A first AUSD transfer costs more than a transfer to an already funded holder.
        const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address,amount] });
        const gas = await pub.estimateGas({ account: account.address, to: ADDR.stake, data });
        const request = await wallet.prepareTransactionRequest({ account, to: ADDR.stake, gas: gas * 120n / 100n, data });
        const raw = await wallet.signTransaction(request);
        return { raw, hash: keccak256(raw) };
      },
      broadcast: (serializedTransaction) => pub.sendRawTransaction({ serializedTransaction }),
      receipt: (hash) => pub.getTransactionReceipt({ hash }).catch(() => undefined),
      wait: (hash) => pub.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 500 }),
    }, ADDR.stake);
  }
  return service;
}

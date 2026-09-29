// Sponsored-call rules shared by the keeper and the browser.
// The digest must match RelayDelegate.sol exactly:
//   Execute(address target,bytes data,uint256 nonce,uint256 deadline)
//   domain name "longshort.fun", version "1", verifyingContract = the EOA.
import { decodeFunctionData, getAddress, isAddressEqual, type Address, type Hex } from 'viem';
import { arenaAbi, erc20Abi } from './abis';

export const RELAY_NAME = 'longshort.fun';
export const RELAY_VERSION = '1';

export const relayTypes = {
  Execute: [
    { name: 'target', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const ARENA_FNS = new Set(['createMatch', 'joinMatch', 'leave', 'open', 'close', 'setClass']);

export const relayLive = (addr?: string | null): addr is Address =>
  !!addr && addr !== '0x0000000000000000000000000000000000000000';

/** What an EOA currently delegates to, if its code is an EIP-7702 designator. */
export function delegatedTo(code?: string | null): Address | 'empty' | 'other' {
  if (!code || code === '0x') return 'empty';
  const c = code.toLowerCase();
  if (!c.startsWith('0xef0100') || c.length !== 48) return 'other';
  return getAddress(`0x${c.slice(8)}`);
}

/** Calls the delegate is willing to forward: Arena gameplay, or an approve whose spender is the Arena. */
export function relayAllowed(arena: Address, stake: Address, target: Address, data: Hex): boolean {
  // RelayDelegate rejects anything outside 4..1024 bytes before it looks at the selector.
  if (!data.startsWith('0x') || data.length < 10 || data.length > 2 + 1024 * 2) return false;
  try {
    if (isAddressEqual(target, stake)) {
      const dec = decodeFunctionData({ abi: erc20Abi, data });
      return dec.functionName === 'approve' && isAddressEqual(dec.args[0] as Address, arena);
    }
    if (isAddressEqual(target, arena)) {
      const dec = decodeFunctionData({ abi: arenaAbi, data });
      return ARENA_FNS.has(dec.functionName);
    }
  } catch {
    return false;
  }
  return false;
}

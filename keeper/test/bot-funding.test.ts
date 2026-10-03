import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';

process.env.TEST_CHAIN_PROFILE = 'live';
process.env.ENV_FILE = '.env.test-does-not-exist';
process.env.DB_PATH = ':memory:';
process.env.RPC_URL = 'http://127.0.0.1:1';
process.env.KEEPER_KEY = `0x${'1'.repeat(64)}`;
process.env.FAUCET_KEY = `0x${'2'.repeat(64)}`;
process.env.BOT_MNEMONIC = 'test test test test test test test test test test test junk';
const { fundBot } = await import('../src/bots');
const { pub } = await import('../src/chain');
const { ADDR } = await import('@longshort/shared');
const original = { balance: pub.getBalance, read: pub.readContract, estimate: pub.estimateContractGas, wait: pub.waitForTransactionReceipt };
const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
let allowance = 0n, receiptStatus = 'success', broadcasts = 0;
const bot = { name: 'fixture', account, strat: 'momentum', wallet: { writeContract: async (request: any) => {
  assert.equal(request.address, ADDR.stake);
  assert.deepEqual(request.args, [ADDR.arena, 150_000_000n]);
  assert.ok(request.gas >= 71_111n, 'approval must cover the AUSD proxy gas estimate');
  broadcasts++;
  return `0x${'a'.repeat(64)}`;
} } } as unknown as Parameters<typeof fundBot>[0];
beforeEach(() => {
  allowance = 0n; receiptStatus = 'success'; broadcasts = 0;
  (pub as any).getBalance = async () => 10n ** 18n;
  (pub as any).readContract = async (request: any) => request.functionName === 'allowance' ? allowance : 250_000_000n;
  (pub as any).estimateContractGas = async () => 71_111n;
  (pub as any).waitForTransactionReceipt = async () => { if (receiptStatus === 'success') allowance = 150_000_000n; return { status: receiptStatus }; };
});
afterEach(() => {
  (pub as any).getBalance = original.balance; (pub as any).readContract = original.read;
  (pub as any).estimateContractGas = original.estimate; (pub as any).waitForTransactionReceipt = original.wait;
});

test('a live bot waits for a sufficient-gas bounded approval and renews after its entry consumes allowance', async () => {
  await fundBot(bot);
  assert.equal(allowance, 150_000_000n); assert.equal(broadcasts, 1);
  await fundBot(bot); assert.equal(broadcasts, 1);
  allowance = 45_000_000n;
  await fundBot(bot); assert.equal(allowance, 150_000_000n); assert.equal(broadcasts, 2);
});

test('a reverted approval or failed gas estimate never marks a bot as funded and approved', async () => {
  receiptStatus = 'reverted';
  await assert.rejects(fundBot(bot), /approval did not confirm/);
  assert.equal(allowance, 0n);
  const previous = broadcasts;
  (pub as any).estimateContractGas = async () => { throw new Error('RPC unavailable'); };
  await assert.rejects(fundBot(bot), /RPC unavailable/);
  assert.equal(broadcasts, previous, 'no fixed-cap transaction is broadcast when estimation fails');
});

test('an unavailable AUSD budget prevents approval and a false ready result', async () => {
  (pub as any).readContract = async () => 0n;
  await assert.rejects(fundBot(bot), /AUSD budget unavailable/);
  assert.equal(broadcasts, 0);
});

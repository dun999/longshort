import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createSecp256k1SigningSession} from '@category-labs/mera';
import {toViemAccount} from '@category-labs/mera/viem';
import {createPublicClient,encodeFunctionData,http,maxUint256} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {ADDR,activeChain,erc20Abi,relayDelegateAbi,relayTypes,RELAY_NAME,RELAY_VERSION} from '@longshort/shared';
import {env} from '../src/env';
assert.equal(activeChain.id,10143);
const pub=createPublicClient({chain:activeChain,transport:http(env.rpcUrl)});
const session=createSecp256k1SigningSession({privateKey:mnemonicToAccount(env.botMnemonic,{addressIndex:101}).getHdKey().privateKey!});
const account=toViemAccount(session);
const path='/tmp/longshort-relay-retry.json';
const base=process.env.SMOKE_API??'http://127.0.0.1:8790';
async function post(body:any){const response=await fetch(base+'/relay',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const r=await response.json();if(r.error)throw new Error(r.error);return r;}
try {
  let evidence:any;
  if(process.env.RETRY_AFTER_RESTART==='1'){
    evidence=JSON.parse(readFileSync(path,'utf8'));
    const replay=await post(evidence.body);
    assert.equal(replay.hash,evidence.hash,'restart replays the same durable receipt');
  }else{
    const nonce=await pub.readContract({address:account.address,abi:relayDelegateAbi,functionName:'nonce'});
    const data=encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[ADDR.arena,maxUint256]});
    const deadline=BigInt(Math.floor(Date.now()/1000)+300);
    const signature=await account.signTypedData({domain:{name:RELAY_NAME,version:RELAY_VERSION,chainId:activeChain.id,verifyingContract:account.address},types:relayTypes,primaryType:'Execute',message:{target:ADDR.stake,data,nonce,deadline}});
    const body={from:account.address,target:ADDR.stake,data,nonce:String(nonce),deadline:String(deadline),signature};
    const first=await post(body);const replay=await post(body);assert.equal(first.hash,replay.hash);
    evidence={body,hash:first.hash,beforeNonce:String(nonce)};
    writeFileSync(path,JSON.stringify(evidence),{mode:0o600});
  }
  assert.equal(await pub.readContract({address:account.address,abi:relayDelegateAbi,functionName:'nonce'}),BigInt(evidence.beforeNonce)+1n);
  console.log('PASS: same signed request executes once',process.env.RETRY_AFTER_RESTART==='1'?'across restart':'across repeated responses',evidence.hash);
}finally{session.end();}

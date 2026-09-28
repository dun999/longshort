'use client';
import {createPasskeyWithPrfOutput,getPasskeyPrfOutput,createSecp256k1SigningSession,type Secp256k1SigningSession} from '@category-labs/mera';
import {toViemAccount} from '@category-labs/mera/viem';
import {sha256,toBytes,type LocalAccount} from 'viem';
let session:Secp256k1SigningSession|undefined;let expiry:ReturnType<typeof setTimeout>|undefined;
export function endWallet(){session?.end();session=undefined;clearTimeout(expiry)}
export async function unlockWallet(create=false,username='Trader'):Promise<LocalAccount>{
 if(!window.isSecureContext)throw new Error('Passkeys need a secure connection.');
 const host=location.hostname;
 if(host!=='longshort.fun'&&host!=='localhost'&&host!=='127.0.0.1')throw new Error('Passkey accounts open on longshort.fun. Practice works here now.');
 endWallet();const rp={id:host,name:'longshort.fun'};
 const output=create?await createPasskeyWithPrfOutput({rp,user:{name:username,displayName:username}}):await getPasskeyPrfOutput({rpId:rp.id});
 // Domain separation fixes account derivation v1; raw PRF entropy is never stored.
 const joined=new Uint8Array([...new TextEncoder().encode('longshort.fun/evm/v1'),...output.prfOutput]);
 const key=toBytes(sha256(joined));joined.fill(0);output.prfOutput.fill(0);
 try{session=createSecp256k1SigningSession({privateKey:key});}finally{key.fill(0)}
 expiry=setTimeout(endWallet,15*60*1000);window.addEventListener('pagehide',endWallet,{once:true});
 return toViemAccount(session);
}

import {bindings} from './db';
// Ranked play fails closed until the deployed protocol passes integration checks.
// Never substitute practice results for on-chain fills or settlement receipts.
export async function handleArena(_req:Request,_path:string,_user:{id:string;address:`0x${string}`}){
 const env=bindings();
 return Response.json({error:env.ARENA_ADDRESS?'Arena account preparation has not passed the deployment checks.':'Arena contracts are not deployed yet.',code:'ARENA_NOT_READY'},{status:503,headers:{'Cache-Control':'no-store'}});
}

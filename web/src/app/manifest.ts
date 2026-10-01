import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name:'longshort.fun',short_name:'longshort',description:'Passkey trading duels with AUSD on Monad testnet',
    start_url:'/play',display:'standalone',background_color:'#0c0d10',theme_color:'#0c0d10',
    icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}] };
}

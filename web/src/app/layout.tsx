import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono, Saira } from 'next/font/google';
import './globals.css';

const chakra = Chakra_Petch({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-chakra' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
// landing display face: a variable width axis lets headlines run extra-condensed italic. Italic only:
// every Saira headline and canvas label is italic, and the upright face was a ~100 KB preload on every page
const saira = Saira({ subsets: ['latin'], axes: ['wdth'], style: ['italic'], variable: '--font-saira' });
const jet = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jet' });

// The public gate uses this neutral layout. Game and shared-result routes enforce their sessions.
export const metadata: Metadata = { title: 'longshort.fun', manifest:'/manifest.webmanifest', appleWebApp:{capable:true,title:'longshort',statusBarStyle:'black-translucent'},icons:{icon:'/icon-192.png',apple:'/icon-192.png'} };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${inter.variable} ${jet.variable} ${saira.variable}`}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono, Saira } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

const chakra = Chakra_Petch({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-chakra' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
// landing display face: a variable width axis lets headlines run extra-condensed italic
const saira = Saira({ subsets: ['latin'], axes: ['wdth'], style: ['normal', 'italic'], variable: '--font-saira' });
const jet = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jet' });

export const metadata: Metadata = {
  title: 'longshort.fun — PvP perp arena on Monad',
  description: 'Duel, squad up or survive the royale. Every trade is an onchain tx on Monad, priced by Perpl, settled by the ArenaCore contract.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${inter.variable} ${jet.variable} ${saira.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono, Saira } from 'next/font/google';
import './globals.css';

const chakra = Chakra_Petch({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-chakra' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
// landing display face: a variable width axis lets headlines run extra-condensed italic
const saira = Saira({ subsets: ['latin'], axes: ['wdth'], style: ['normal', 'italic'], variable: '--font-saira' });
const jet = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jet' });

// Neutral on purpose: the gate and shared-result pages sit on this layout alone and are reachable
// without the access code. The game's own layout, (game)/layout.tsx, says what longshort is.
export const metadata: Metadata = { title: 'longshort.fun' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${chakra.variable} ${inter.variable} ${jet.variable} ${saira.variable}`}>
      <body>{children}</body>
    </html>
  );
}

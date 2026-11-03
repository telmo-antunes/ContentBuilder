import type { Metadata, Viewport } from 'next';
import { Inter, Poppins } from 'next/font/google';
import './globals.css';

const text = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-text', display: 'swap' });
const display = Poppins({ subsets: ['latin', 'latin-ext'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = { title: 'ContentBuilder', description: 'Say what you want to post. Get Instagram-ready slides.' };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f4f3fb' }, { media: '(prefers-color-scheme: dark)', color: '#0c0b14' }],
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${text.variable} ${display.variable}`}><body>{children}</body></html>;
}

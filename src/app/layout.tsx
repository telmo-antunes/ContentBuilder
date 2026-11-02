import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'ContentBuilder', description: 'Turn your brief and website inspiration into slides.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

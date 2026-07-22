import type { Metadata } from 'next';
import './globals.css';
import AppChrome from './components/AppChrome';
import ConfirmHost from './components/ConfirmDialog';
import ToastHost from './components/Toast';

export const metadata: Metadata = {
  title: 'ContentBuilder',
  description: 'On-brand Instagram carousel & story asset generator',
};

// Runs before paint so the saved theme is applied with no flash of the wrong one.
const themeInit = `(function(){try{var t=localStorage.getItem('cb-theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <AppChrome />
        <main className="container">{children}</main>
        <ConfirmHost />
        <ToastHost />
      </body>
    </html>
  );
}

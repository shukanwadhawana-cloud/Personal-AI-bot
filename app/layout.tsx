import { Providers } from './providers';

export const metadata = {
  title: 'Personal AI Bot',
  description: 'Persistent cloud coding agent controllable from iPhone/iPad',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#111',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fafafa', color: '#111' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

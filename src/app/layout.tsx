import './globals.css';
import type { Metadata } from 'next';

// Self-hosted Inter (served from our own origin, so the app's strict CSP allows
// it — the design system's stylesheet asks for `font-family: 'Inter'`, which
// these @font-face rules now satisfy locally instead of via Google Fonts).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import '@assembly-js/design-system/dist/styles/main.css';

export const metadata: Metadata = {
  title: 'Custom App',
  description: 'Assembly Custom App Example',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

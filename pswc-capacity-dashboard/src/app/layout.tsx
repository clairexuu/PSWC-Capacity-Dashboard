import type { Metadata } from "next";
import "./globals.css";
import Navigation from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'PSWC Capacity Dashboard',
  description: 'Track animal intake and care capacity in real time',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" style={{ colorScheme: 'light' }}>
      <body style={{ backgroundColor: '#ffffff', color: '#000000' }}>
        <Navigation />
        <main style={{ backgroundColor: '#ffffff', color: '#000000' }}>{children}</main>
      </body>
    </html>
  );
}
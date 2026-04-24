import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ATLAS - Asset & IT Operations',
  description: 'ATLAS on-prem migration with 1:1 Google Apps Script UI parity baseline'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          type="image/png"
          href="https://raw.githubusercontent.com/rickoprayudha-ATI/itops-portal-assets/main/IT%20Operations%20logo.png?v=20260304"
        />
        <link
          rel="apple-touch-icon"
          href="https://raw.githubusercontent.com/rickoprayudha-ATI/itops-portal-assets/main/IT%20Operations%20logo.png?v=20260304"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;0,14..32,900;1,14..32,400;1,14..32,500&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

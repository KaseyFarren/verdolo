import type { Metadata } from "next";
import { Syne, Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  weight: ["700", "800"],
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Verdolo",
  description: "Run your agency - clients, tasks, time, and billing in one place.",
};

// The per-request CSP nonce (set in the proxy middleware) can only be stamped onto
// script tags during dynamic rendering. Statically prerendered pages would ship
// without a nonce and get blocked by 'strict-dynamic', so opt the whole app into
// dynamic rendering. This app is almost entirely per-request already.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster
          theme="light"
          position="bottom-right"
          toastOptions={{
            duration: 1000,
            style: {
              background: '#f7f1ea',
              border: '1px solid rgba(26,26,23,0.1)',
              color: '#1a1a17',
            },
          }}
        />
      </body>
    </html>
  );
}

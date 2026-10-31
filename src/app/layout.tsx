import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], variable: "--font-newsreader" });

export const metadata: Metadata = {
  title: { default: "Normal Finance", template: "%s · Normal Finance" },
  description: "Claims, budgets and reimbursements for Normal.",
  robots: { index: false, follow: false },
  // Added to an iPhone's home screen, it opens full screen with this name (the manifest covers Android).
  appleWebApp: { capable: true, title: "Normal Finance", statusBarStyle: "default" },
};

// The browser's bar, and the installed app's title bar, take the page's background colour.
export const viewport: Viewport = { themeColor: "#f7f5f1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG" className={`${inter.variable} ${newsreader.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

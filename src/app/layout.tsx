import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], variable: "--font-newsreader" });

export const metadata: Metadata = {
  title: { default: "Normal Finance", template: "%s · Normal Finance" },
  description: "Claims, budgets and reimbursements for Normal.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG" className={`${inter.variable} ${newsreader.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

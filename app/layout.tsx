import type { Metadata } from "next";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";

// Inter for Latin text and figures; Noto Sans Bengali for Bangla and the ৳
// sign, which Latin UI fonts lack (it fell back to a tiny system glyph).
const inter = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", display: "swap" });

export const metadata: Metadata = {
  title: "Shathi Sheba Admin",
  description: "Admin MIS, content management, and API backend for Shathi Sheba"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${bengali.variable}`}>
      <body>{children}</body>
    </html>
  );
}

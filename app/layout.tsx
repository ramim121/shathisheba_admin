import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

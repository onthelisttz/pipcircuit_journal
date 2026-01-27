import type { Metadata } from "next";
import { type ReactNode } from "react";
import { ThemeProvider } from "@ui/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Trading Journal",
  description:
    "Offline-first trading journal with analytics and multi-device sync",
  keywords: ["trading", "journal", "forex", "ctrader", "analytics"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

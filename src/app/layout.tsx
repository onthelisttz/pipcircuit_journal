import type { Metadata } from "next";
import { type ReactNode } from "react";
import { AuthProvider, ThemeProvider } from "@ui/providers";
import { ServiceWorkerRegistration } from "@ui/components/pwa/ServiceWorkerRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "pipCircuit",
    template: "%s | pipCircuit",
  },
  description:
    "Offline-first trading analytics and journaling app with multi-device sync",
  keywords: ["trading", "journal", "forex", "ctrader", "analytics"],
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <ServiceWorkerRegistration />
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

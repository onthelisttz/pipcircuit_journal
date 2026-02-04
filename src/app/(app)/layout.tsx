"use client";

import { useState, type ReactNode } from "react";

import { AuthGuard, Header, Sidebar } from "@ui/components/layout";
import { TradePanel } from "@ui/components/panels";
import { TradePanelProvider } from "@ui/providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <AuthGuard>
      <TradePanelProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar className="hidden md:flex" />
          {isSidebarOpen && (
            <div className="fixed inset-0 z-40 md:hidden">
              <div
                className="absolute inset-0 bg-black/60"
                onClick={() => setIsSidebarOpen(false)}
              />
              <Sidebar className="relative z-50 h-full shadow-xl" />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Header onMenuToggle={() => setIsSidebarOpen((prev) => !prev)} />
            <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-0">{children}</main>
          </div>
          <TradePanel />
        </div>
      </TradePanelProvider>
    </AuthGuard>
  );
}

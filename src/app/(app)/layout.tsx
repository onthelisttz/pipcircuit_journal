"use client";

import { useState, type ReactNode } from "react";

import { AuthGuard, Header, Sidebar } from "@ui/components/layout";

export default function AppLayout({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-background text-foreground">
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
        <div className="flex w-full flex-col">
          <Header onMenuToggle={() => setIsSidebarOpen((prev) => !prev)} />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}

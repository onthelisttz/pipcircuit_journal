import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "cTrader Link",
};

export default function CTraderCallbackLayout({ children }: { children: ReactNode }) {
  return children;
}

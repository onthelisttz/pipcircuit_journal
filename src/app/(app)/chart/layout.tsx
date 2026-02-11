import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Chart",
};

export default function ChartLayout({ children }: { children: ReactNode }) {
  return children;
}

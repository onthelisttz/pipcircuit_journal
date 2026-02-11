import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Signing In",
};

export default function AuthCallbackLayout({ children }: { children: ReactNode }) {
  return children;
}

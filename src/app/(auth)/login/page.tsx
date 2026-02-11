import type { Metadata } from "next";
import { LoginPage } from "@ui/features/auth";

export const metadata: Metadata = {
  title: "Login",
};

export default function Login() {
  return <LoginPage />;
}

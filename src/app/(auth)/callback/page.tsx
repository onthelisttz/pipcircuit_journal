"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@ui/hooks";

export default function AuthCallback() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? "/dashboard" : "/login");
    }
  }, [loading, router, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      Finishing sign-in...
    </div>
  );
}

import { useCallback, useMemo } from "react";

import { LoginUseCase, LogoutUseCase } from "@application/use-cases";
import { SupabaseAuthService } from "@infrastructure/auth";
import { useAuthStore } from "@ui/state";

const authService = new SupabaseAuthService();

export function useAuth() {
  const { user, session, loading, setSession, clear } = useAuthStore();

  const login = useCallback(async () => {
    const useCase = new LoginUseCase(authService);
    await useCase.execute();
  }, []);

  const logout = useCallback(async () => {
    const useCase = new LogoutUseCase(authService);
    await useCase.execute();
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      setSession,
      login,
      logout,
    }),
    [user, session, loading, setSession, login, logout]
  );

  return value;
}

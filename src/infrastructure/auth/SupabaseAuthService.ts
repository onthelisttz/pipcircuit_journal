import { createClient, type Session } from "@supabase/supabase-js";

import type { AuthSession, AuthUser, IAuthService } from "@application/ports/services";
import { env } from "@config/env";

function toAuthUser(session: Session): AuthUser {
  const user = session.user;
  return {
    id: user.id,
    email: user.email ?? undefined,
    name: user.user_metadata?.full_name ?? undefined,
    avatarUrl: user.user_metadata?.avatar_url ?? undefined,
  };
}

function toAuthSession(session: Session): AuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? undefined,
    expiresAt: session.expires_at ?? undefined,
    user: toAuthUser(session),
  };
}

export class SupabaseAuthService implements IAuthService {
  private readonly client = createClient(env.supabaseUrl, env.supabaseAnonKey);

  async signInWithGoogle(): Promise<void> {
    await this.client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: env.supabaseRedirectUri || undefined,
      },
    });
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async getSession(): Promise<AuthSession | null> {
    const { data } = await this.client.auth.getSession();
    if (!data.session) {
      return null;
    }
    return toAuthSession(data.session);
  }

  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      callback(session ? toAuthSession(session) : null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }
}

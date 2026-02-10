import { createClient, type Session } from "@supabase/supabase-js";

import type { AuthSession, AuthUser, IAuthService } from "@application/ports/services";
import { env } from "@config/env";

const missingConfigMessage =
  "Supabase configuration missing. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.";

let warnedMissingConfig = false;

function createMissingClient() {
  if (!warnedMissingConfig) {
    warnedMissingConfig = true;
    console.error(missingConfigMessage);
  }
  return new Proxy({} as ReturnType<typeof createClient>, {
    get() {
      throw new Error(missingConfigMessage);
    },
  });
}

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
  private client: ReturnType<typeof createClient> | null = null;

  private getClient() {
    if (!this.client) {
      if (!env.supabaseUrl || !env.supabaseAnonKey) {
        this.client = createMissingClient();
      } else {
        this.client = createClient(env.supabaseUrl, env.supabaseAnonKey);
      }
    }
    return this.client;
  }

  async signInWithGoogle(): Promise<void> {
    await this.getClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: env.supabaseRedirectUri || undefined,
      },
    });
  }

  async signOut(): Promise<void> {
    await this.getClient().auth.signOut();
  }

  async getSession(): Promise<AuthSession | null> {
    const { data } = await this.getClient().auth.getSession();
    if (!data.session) {
      return null;
    }
    return toAuthSession(data.session);
  }

  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
    const { data } = this.getClient().auth.onAuthStateChange((_event, session) => {
      callback(session ? toAuthSession(session) : null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }
}

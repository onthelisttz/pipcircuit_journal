import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@config/env";

let supabaseClient: SupabaseClient | null = null;
let warnedMissingConfig = false;
const missingConfigMessage =
  "Supabase configuration missing. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.";

function createMissingClient(): SupabaseClient {
  if (!warnedMissingConfig) {
    warnedMissingConfig = true;
    // Log once to help surface misconfiguration without breaking build-time evaluation.
    // Actual use will still throw via the proxy below.
    console.error(missingConfigMessage);
  }
  return new Proxy({} as SupabaseClient, {
    get() {
      throw new Error(missingConfigMessage);
    },
  });
}

/**
 * Get or create Supabase client instance
 * Uses singleton pattern to ensure single instance across the app
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!env.supabaseUrl || !env.supabaseAnonKey) {
      supabaseClient = createMissingClient();
      return supabaseClient;
    }

    supabaseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return supabaseClient;
}

/**
 * Create a new Supabase client with custom auth token
 * Useful for server-side operations with service role key
 */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Reset the singleton client (useful for testing)
 */
export function resetSupabaseClient(): void {
  supabaseClient = null;
}

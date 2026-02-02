export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseRedirectUri: process.env.NEXT_PUBLIC_SUPABASE_REDIRECT_URI ?? "",
  ctraderApiBase: process.env.NEXT_PUBLIC_CTRADER_API_BASE ?? "https://openapi.ctrader.com",
  ctraderOauthBase: process.env.NEXT_PUBLIC_CTRADER_OAUTH_BASE ?? "https://id.ctrader.com",
  ctraderClientId: process.env.NEXT_PUBLIC_CTRADER_CLIENT_ID ?? "",
  ctraderRedirectUri: process.env.NEXT_PUBLIC_CTRADER_REDIRECT_URI ?? "",
};

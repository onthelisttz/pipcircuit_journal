import { NextResponse } from "next/server";

const apiBase = process.env.NEXT_PUBLIC_CTRADER_API_BASE ?? "https://openapi.ctrader.com";
const clientId = process.env.NEXT_PUBLIC_CTRADER_CLIENT_ID ?? "";
const clientSecret = process.env.CTRADER_CLIENT_SECRET ?? "";
const redirectUri = process.env.NEXT_PUBLIC_CTRADER_REDIRECT_URI ?? "";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Missing cTrader env configuration" },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${apiBase}/apps/token?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    return NextResponse.json({ error: `cTrader OAuth error ${response.status}` }, { status: 502 });
  }

  const data = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: string;
    errorCode?: string | null;
    description?: string | null;
  };

  if (data.errorCode) {
    return NextResponse.json(
      { error: data.description ?? "cTrader OAuth error", code: data.errorCode },
      { status: 502 }
    );
  }

  return NextResponse.json(data);
}

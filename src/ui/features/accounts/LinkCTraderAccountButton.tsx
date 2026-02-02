"use client";

import { CTraderAPI } from "@infrastructure/api/ctrader";

export function LinkCTraderAccountButton() {
  const handleClick = () => {
    const api = new CTraderAPI();
    const authUrl = api.getAuthUrl();
    window.open(authUrl, "ctrader-oauth", "width=520,height=720");
  };

  return (
    <button
      onClick={handleClick}
      className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white
      transition-colors hover:bg-emerald-600"
    >
      Link cTrader Account
    </button>
  );
}

import fs from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import OfflinePage from "@/app/offline/page";

describe("Offline PWA shell", () => {
  it("renders a dedicated offline page shell", () => {
    const html = renderToStaticMarkup(<OfflinePage />);
    expect(html).toContain("You are offline");
    expect(html).toContain("app shell is available");
  });

  it("service worker precaches and falls back to /offline", async () => {
    const swPath = path.join(process.cwd(), "public", "sw.js");
    const source = await fs.readFile(swPath, "utf8");

    expect(source).toContain('const OFFLINE_URL = "/offline"');
    expect(source).toContain('"/login"');
    expect(source).toContain("OFFLINE_URL,");
    expect(source).toContain("request.mode === \"navigate\"");
    expect(source).toContain("const cachedOffline = await pageCache.match(OFFLINE_URL)");
  });
});

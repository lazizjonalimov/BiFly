import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

// Guards for how the web app behaves at its edges: behind proxies, inside frames, and against forged requests.
// These assume the default configuration (BIFLY_ALLOW_EMBEDDING is not set).

test("signing up works behind a proxy that rewrites the Host header", async ({ page, baseURL }) => {
  // Load balancers and preview tunnels often show the app a different Host than the address in the browser.
  // The same-origin check must not depend on that header, or every sign-in is rejected as "cross-origin".
  const target = new URL(baseURL!);
  const proxy = http.createServer((req, res) => {
    const upstream = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const publicUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  try {
    await page.goto(`${publicUrl}/`);
    await page.waitForURL(`${publicUrl}/login`); // redirects stay on the public address, not the internal one
    await page.getByRole("link", { name: "Create an account" }).click();
    const fill = (label: string, value: string) => page.getByLabel(label, { exact: true }).filter({ visible: true }).fill(value);
    await fill("Company name", "Behind Proxy Freight");
    await fill("Your name", "Pat Proxy");
    await fill("Work email", `proxy-${Date.now().toString(36)}@example.com`);
    await fill("Password", "correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(page.url()).toBe(`${publicUrl}/`);
  } finally {
    proxy.closeAllConnections();
    proxy.close();
  }
});

test("the app refuses to be framed and rejects writes from other sites", async ({ request }) => {
  const page = await request.get("/login");
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");

  // What a browser sends when another site's page tries to post to us. Scripts can't change this header.
  const crossSite = await request.post("/api/session/login", {
    headers: { "sec-fetch-site": "cross-site" },
    data: { email: "someone@example.com", password: "irrelevant-password" },
  });
  expect(crossSite.status()).toBe(403);
  const siblingSite = await request.post("/api/session/logout", { headers: { "sec-fetch-site": "same-site" } });
  expect(siblingSite.status()).toBe(403);
  // Older browsers without that header: fall back to comparing Origin with the host.
  const foreignOrigin = await request.post("/api/session/logout", { headers: { origin: "https://evil.example" } });
  expect(foreignOrigin.status()).toBe(403);
  // And the genuine article is let through (401: wrong credentials, not 403).
  const sameOrigin = await request.post("/api/session/login", {
    headers: { "sec-fetch-site": "same-origin" },
    data: { email: "someone@example.com", password: "irrelevant-password" },
  });
  expect(sameOrigin.status()).toBe(401);
});

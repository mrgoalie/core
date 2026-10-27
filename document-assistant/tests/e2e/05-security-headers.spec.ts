import { expect, test } from "@playwright/test";

test("pages and API responses carry the browser security headers", async ({ request }) => {
  const page = await request.get("/login");
  expect(page.status()).toBe(200);
  const h = page.headers();
  const csp = h["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();

  // Each page load gets a fresh nonce.
  const again = (await request.get("/login")).headers()["content-security-policy"];
  expect(again).not.toBe(csp);

  const api = await request.get("/api/home");
  expect(api.status()).toBe(401);
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");
});

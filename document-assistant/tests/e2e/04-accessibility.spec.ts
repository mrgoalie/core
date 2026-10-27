import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${label}: ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([]);
}

test("automated accessibility checks on the main employee and administrator screens", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Maria Lopez/ })).toBeVisible();
  await audit(page, "login");

  await loginAs(page, "Maria Lopez");
  await audit(page, "home");
  await page.getByRole("button", { name: /Write a Demand Letter/ }).click();
  await page.waitForURL(/\/work\//);
  await expect(page.getByText("Okafor v. Midway Fresh Market")).toBeVisible();
  await audit(page, "step 1");
  await page.getByLabel(/Okafor v. Midway Fresh Market/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await audit(page, "step 2");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create the draft" }).click();
  await expect(page.getByRole("heading", { name: /need attention/ })).toBeVisible({ timeout: 120_000 });
  await audit(page, "step 3");
  await page.goto("/work");
  await audit(page, "my work");

  await loginAs(page, "Jordan Ellis");
  const skills = await (await page.request.get("/api/admin/skills")).json();
  const firstSkill = `/admin/skills/${skills.skills[0].id}`;
  for (const path of ["/review", "/admin", "/admin/employees", "/admin/skills", "/admin/skills/new", firstSkill, "/admin/interface", "/admin/templates", "/admin/activity", "/admin/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await audit(page, path);
  }
});

test("the main task can be completed with the keyboard alone", async ({ page }) => {
  await loginAs(page, "Maria Lopez");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  let found = false;
  for (let i = 0; i < 25 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.textContent?.includes("Write a Demand Letter") ?? false);
  }
  expect(found).toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/work\//);
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.getByLabel(/Thompson v. Ridgeway Logistics/)).toBeVisible();
  await page.keyboard.type("Okafor");
  await expect(page.getByLabel(/Thompson v. Ridgeway Logistics/)).toHaveCount(0);
  await expect(page.getByLabel(/Okafor v. Midway Fresh Market/)).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.getByLabel(/Okafor v. Midway Fresh Market/)).toBeChecked();
});

test("layouts fit phone and tablet screens without sideways scrolling", async ({ page }) => {
  await loginAs(page, "Maria Lopez");
  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/work", "/help"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

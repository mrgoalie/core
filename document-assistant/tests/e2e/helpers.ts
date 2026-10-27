import { expect, type Browser, type Page } from "@playwright/test";

export async function loginAs(page: Page, name: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

export async function newUser(browser: Browser, name: string) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await loginAs(page, name);
  return { context, page };
}

export async function download(page: Page, linkName: RegExp | string) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: linkName }).first().click()]);
  const path = await dl.path();
  const fs = await import("node:fs");
  return { bytes: fs.readFileSync(path!), fileName: dl.suggestedFilename() };
}

/** Toggles one of the on/off switches by clicking its visible label, as a person would. */
export async function setSwitch(row: import("@playwright/test").Locator, on: boolean) {
  const sw = row.getByRole("switch");
  if ((await sw.isChecked()) !== on) await row.locator("label.switch").click();
  await expect(sw).toBeChecked({ checked: on });
}

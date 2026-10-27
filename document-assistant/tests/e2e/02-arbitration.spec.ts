import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { download, loginAs, newUser } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Arbitration demonstration: organized PDF package, missing requirements, attorney approval", async ({ page, browser }) => {
  await loginAs(page, "Maria Lopez");
  // 1. Selects Create an Arbitration Package.
  await page.getByRole("button", { name: /Create an Arbitration Package/ }).click();
  await page.waitForURL(/\/work\//);
  // 2. Opens a fictional matter.
  await page.getByLabel(/Rivera — Uninsured Motorist Claim/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("AAA — Uninsured Motorist (UM)").check();
  await expect(page.locator(".req-label", { hasText: "Correspondence giving notice of the claim to the insurer" })).toBeVisible();

  // 3. Selects supporting exhibits and puts them in order.
  await expect(page.getByRole("checkbox", { name: /Westlawn Chiropractic - Bill\.pdf/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /Witness Statement - J\. Okonkwo\.txt/ }).uncheck();
  await page.getByRole("checkbox", { name: /Witness Statement - J\. Okonkwo\.txt/ }).check();
  const order = page.locator("h3:has-text('Exhibit order') ~ ol li");
  await expect(order.first()).toContainText("Demand for Arbitration");
  await page.getByRole("button", { name: "Move Traffic Crash Report - MPD-24-0802-0310.pdf up" }).click();
  await page.getByRole("button", { name: "Move Traffic Crash Report - MPD-24-0802-0310.pdf up" }).click();
  await expect(order.first()).toContainText("Traffic Crash Report");
  await page.getByRole("button", { name: "Read the documents" }).click();
  await expect(page.getByText("Documents were read")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  // 4. Generates an actual organized PDF package.
  await page.getByRole("button", { name: "Create the draft" }).click();
  await expect(page.getByRole("heading", { name: /need attention/ })).toBeVisible({ timeout: 120_000 });
  const tools = page.getByRole("complementary", { name: "Review tools" });
  await expect(tools.getByRole("heading", { name: "Exhibit index" })).toBeVisible();
  await expect(tools.locator("ol li").first()).toContainText("Traffic Crash Report");
  const pkg = await download(page, /Exhibit package/);
  const pdf = await PDFDocument.load(pkg.bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(15);

  // 5. Reviews missing requirements.
  await expect(tools).toContainText("Missing document: Correspondence giving notice of the claim to the insurer.");
  await expect(tools).toContainText(/DEMONSTRATION settings/);

  // 6. Submits the package for approval.
  await page.getByRole("button", { name: "Send for attorney review" }).click();
  await expect(page.getByText("Waiting for attorney review").first()).toBeVisible();
  const url = page.url();

  // An attorney approves it.
  const { page: rachel, context } = await newUser(browser, "Rachel Patel");
  await rachel.goto("/review");
  await expect(rachel.getByText(/Create an Arbitration Package — Rivera/)).toBeVisible();
  await rachel.goto(url);
  await rachel.getByLabel("Comments").fill("Exhibit order confirmed.");
  await rachel.getByRole("button", { name: "Approve" }).click();
  await rachel.getByRole("button", { name: "Yes, approve" }).click();
  await expect(rachel.getByText("Approved by an attorney")).toBeVisible({ timeout: 60_000 });
  const final = await download(rachel, /Exhibit package/);
  expect(final.fileName).toMatch(/FINAL/);
  await context.close();

  await page.reload();
  await expect(page.getByText("Approved by an attorney")).toBeVisible();
});

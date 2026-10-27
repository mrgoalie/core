import { expect, test } from "@playwright/test";
import PizZip from "pizzip";
import { download, loginAs, newUser } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Employee demonstration: demand letter from login to attorney review", async ({ page }) => {
  // 1. Logs in.
  await loginAs(page, "Maria Lopez");
  // 2. Sees only assigned skills.
  await expect(page.getByRole("heading", { name: "What do you need to prepare?" })).toBeVisible();
  const tiles = page.locator(".tile");
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0)).toContainText("Write a Demand Letter");
  await expect(tiles.nth(1)).toContainText("Create an Arbitration Package");

  // 3. Selects Write a Demand Letter.
  await page.getByRole("button", { name: /Write a Demand Letter/ }).click();
  await page.waitForURL(/\/work\//);

  // 4. Opens a fictional matter (and cannot see the restricted criminal matter).
  await expect(page.getByText("Thompson v. Ridgeway Logistics LLC")).toBeVisible();
  await expect(page.getByText("People v. D. Hartley")).toHaveCount(0);
  await page.getByLabel(/Thompson v. Ridgeway Logistics/).check();
  await page.getByRole("button", { name: "Continue" }).click();

  // 5. Reviews information: documents found, read, and answers filled in with sources.
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByLabel(/Traffic Crash Report/)).toBeChecked();
  await page.getByRole("button", { name: "Read the documents" }).click();
  await expect(page.getByText("Documents were read")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel(/Date of the incident/)).toHaveValue("2025-03-14");
  await expect(page.getByText(/From Traffic Crash Report - MPD-25-0314-0072, p\. 1 ✓/).first()).toBeVisible();
  await page.getByLabel(/Why the other party is responsible/).fill("The other driver was cited for failure to reduce speed and admitted looking at his navigation device.");
  await page.getByLabel(/How the injuries have affected/).fill("Ms. Thompson reports ongoing neck stiffness that interrupts her sleep and limits her ability to work full shifts.");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // 6. Generates an actual Word document.
  await page.getByRole("button", { name: "Create the draft" }).click();
  await expect(page.getByRole("heading", { name: /need attention/ })).toBeVisible({ timeout: 120_000 });
  const preview = page.getByRole("article", { name: "Document preview" });
  await expect(preview).toContainText("Dear Mark Delaney:");
  await expect(preview).toContainText("$15,849.00");
  const word = await download(page, /Word document/);
  expect(word.fileName).toMatch(/\.docx$/);
  const docXml = new PizZip(word.bytes).file("word/document.xml")!.asText();
  expect(docXml).toContain("Mark Delaney");
  expect(docXml).toContain("Total economic damages");
  const header = Object.keys(new PizZip(word.bytes).files).filter((f) => /word\/header\d*\.xml/.test(f)).map((f) => new PizZip(word.bytes).file(f)!.asText()).join("");
  expect(header).toContain("DRAFT");
  const pdf = await download(page, /^PDF/);
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");

  // 7. Identifies missing evidence and conflicts.
  const issues = page.getByRole("complementary", { name: "Review tools" });
  await expect(issues).toContainText("Missing information: Missing: Demand amount");
  await expect(issues).toContainText(/Missing evidence:.*Midwest Orthopedic Partners/);
  await expect(issues).toContainText(/Conflicting information:.*March 15, 2025.*March 14, 2025/);

  // 8. Submits the draft for attorney review.
  await page.getByLabel("Attorney", { exact: true }).selectOption({ label: "Rachel Patel" });
  await page.getByLabel(/Note for the attorney/).fill("Demand amount still needed from Jordan.");
  await page.getByRole("button", { name: "Send for attorney review" }).click();
  await expect(page.getByText("Waiting for attorney review").first()).toBeVisible();
  await page.goto("/work");
  await expect(page.locator(".work-list li").first()).toContainText("Waiting for attorney review");
});

test("Another employee sees only the skill assigned to him", async ({ browser }) => {
  const { page, context } = await newUser(browser, "Daniel Kim");
  await expect(page.locator(".tile")).toHaveCount(1);
  await expect(page.locator(".tile")).toContainText("Write a Demand Letter");
  // Direct API attempt to start an unassigned skill is refused by the server.
  const skills = await page.request.get("/api/admin/skills");
  expect(skills.status()).toBe(403);
  await context.close();
});

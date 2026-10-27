import { expect, test, type Page } from "@playwright/test";
import { loginAs, newUser, setSwitch } from "./helpers";

test.describe.configure({ mode: "serial" });

async function runTestOfDraft(page: Page, amount: string, expected: string) {
  await page.getByRole("button", { name: /Versions/ }).click();
  await page.getByRole("button", { name: "Test this version" }).click();
  await page.waitForURL(/\/work\//);
  await expect(page.getByText(/Test run of version/)).toBeVisible();
  await page.getByLabel(/Sample Test Matter/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Settlement amount/).fill(amount);
  await expect(page.getByLabel(/Attorney fee percent/)).toHaveValue("33.33");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create the draft" }).click();
  await expect(page.getByRole("article", { name: "Document preview" })).toContainText(expected, { timeout: 120_000 });
  await page.getByRole("link", { name: "Back to the skill" }).click();
  await page.getByRole("button", { name: /Versions/ }).click();
  await page.getByRole("button", { name: "Test passed" }).click();
  await expect(page.getByText("Test passed").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve as attorney" }).click();
  await expect(page.getByText("Attorney approved").first()).toBeVisible();
}

test("Administrator demonstration: build, test, publish, grant, edit, restore, customize, and disable", async ({ page, browser }) => {
  const daniel = await newUser(browser, "Daniel Kim");
  await loginAs(page, "Jordan Ellis");

  // 1. Creates a new skill without programming.
  await page.goto("/admin/skills");
  await page.getByRole("link", { name: "Create New Skill" }).click();
  await page.getByRole("textbox", { name: "Skill name", exact: true }).fill("Prepare Settlement Disbursement");
  await page.getByRole("textbox", { name: "Short description", exact: true }).fill("Prepare a settlement breakdown showing fees, costs, liens, and client proceeds.");
  await page.getByLabel("Employee instructions").fill("Enter the settlement figures exactly as approved by the attorney.");
  await page.getByRole("textbox", { name: "Instructions", exact: true }).fill(
    "Use the settlement amount and the contractual attorney fee to prepare a settlement disbursement statement. Calculate the client's net proceeds and flag missing information.",
  );
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question", { exact: true }).fill("Settlement amount");
  await page.getByLabel("Type of answer").selectOption({ label: "Dollar amount" });
  await page.getByLabel("Required", { exact: true }).check();
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question", { exact: true }).fill("Attorney fee percent");
  await page.getByLabel("Type of answer").selectOption({ label: "Number" });
  await page.getByLabel("Required", { exact: true }).check();
  await page.getByLabel("Default answer").fill("33.33");

  await page.getByRole("button", { name: "Add a calculation" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Attorney fee");
  await page.getByLabel("What to do").selectOption("percent_of");
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.getByLabel("Value", { exact: true }).nth(0).selectOption({ label: "Answer: Settlement amount" });
  await page.getByLabel("Value", { exact: true }).nth(1).selectOption({ label: "Answer: Attorney fee percent" });
  await page.getByRole("button", { name: "Add a calculation" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Net to client");
  await page.getByLabel("What to do").selectOption("subtract");
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.getByLabel("Value", { exact: true }).nth(0).selectOption({ label: "Answer: Settlement amount" });
  await page.getByLabel("Value", { exact: true }).nth(1).selectOption({ label: "Calculation: Attorney fee" });
  await page.getByRole("button", { name: "Create skill (saved as a draft)" }).click();
  await page.waitForURL(/\/admin\/skills\/[0-9a-f-]+\?created=1/);
  await expect(page.getByText("Skill created as a draft")).toBeVisible();
  const skillUrl = page.url().split("?")[0];
  await expect(page.getByText("Not published yet")).toBeVisible();
  // Saved placeholders take their names from the wording.
  await expect(page.getByText("placeholder {{settlement_amount}}")).toBeVisible();

  // 2. Tests it with fictional data; 3. Publishes it after attorney approval.
  await runTestOfDraft(page, "100000", "$66,670.00");
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Published v1").first()).toBeVisible();

  // 4. Grants it to an employee.
  await page.getByRole("button", { name: /Who can use it/ }).click();
  await setSwitch(page.locator("li", { hasText: "Daniel Kim" }), true);
  await expect(page.locator("li", { hasText: "Daniel Kim" }).getByText("Can use")).toBeVisible();
  await daniel.page.goto("/");
  await expect(daniel.page.locator(".tile")).toHaveCount(2);

  // 5. Edits and republishes it.
  await page.goto(skillUrl);
  await page.getByRole("textbox", { name: "Instructions", exact: true }).fill("Prepare a settlement disbursement statement showing the gross settlement, the attorney fee, and the client's net proceeds.");
  await page.getByPlaceholder("Describe what you changed (optional)").fill("Simplified the instructions");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/needs a test run and attorney approval/)).toBeVisible();
  await runTestOfDraft(page, "90000", "$60,003.00");
  await page.getByRole("button", { name: "Publish version 2" }).click();
  await expect(page.getByText("Published v2").first()).toBeVisible();

  // 6. Restores an earlier version.
  await page.getByRole("button", { name: "Restore this version" }).first().click();
  await page.getByRole("button", { name: "Restore and publish" }).click();
  await expect(page.getByText("Published v3").first()).toBeVisible();
  await expect(page.getByText("Restored version 1").first()).toBeVisible();

  // 7. Changes the employee home-screen layout; 8. publishes the interface changes.
  await page.goto("/admin/interface");
  await page.getByRole("button", { name: "Skills on home screen" }).click();
  const demandRow = page.locator("li", { has: page.getByPlaceholder("Write a Demand Letter", { exact: true }) });
  await demandRow.getByPlaceholder("Write a Demand Letter", { exact: true }).fill("Prepare Insurance Demand");
  await demandRow.getByLabel("Icon").selectOption("gavel");
  await page.getByRole("button", { name: "Move Prepare Settlement Disbursement up" }).click();
  await page.getByRole("button", { name: "Move Prepare Settlement Disbursement up" }).click();
  await page.getByRole("button", { name: "Home screen", exact: true }).click();
  await page.getByLabel("Welcome heading").fill("What would you like to prepare today?");
  await expect(page.getByText("Draft saved")).toBeVisible();
  // Preview as the employee who has the new skill (administrators see what each person would see).
  await page.getByLabel("Preview as").selectOption({ label: "Daniel Kim (2 skills)" });
  const frame = page.frameLocator("iframe[title^='Preview']");
  await expect(frame.getByText(/showing what Daniel Kim would see/)).toBeVisible();
  await expect(frame.getByRole("heading", { name: "What would you like to prepare today?" })).toBeVisible();
  await expect(frame.locator(".tile").first()).toContainText("Prepare Settlement Disbursement");
  await expect(frame.getByText("Prepare Insurance Demand")).toBeVisible();
  // Employees don't see draft changes yet.
  await daniel.page.reload();
  await expect(daniel.page.getByRole("heading", { name: "What do you need to prepare?" })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText(/Published as version 2/)).toBeVisible();
  await daniel.page.reload();
  await expect(daniel.page.getByRole("heading", { name: "What would you like to prepare today?" })).toBeVisible();
  const tiles = daniel.page.locator(".tile");
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0)).toContainText("Prepare Settlement Disbursement");
  await expect(tiles.nth(1)).toContainText("Prepare Insurance Demand");

  // 9. Disables an employee; 10. the employee can no longer reach protected functions.
  await page.goto("/admin/employees");
  await page.getByRole("link", { name: "Manage Daniel Kim" }).click();
  await page.getByRole("button", { name: "Suspend access" }).click();
  await page.getByLabel("Reason (kept in the activity log)").fill("Demonstration of immediate deactivation");
  await page.getByRole("button", { name: "Suspend now" }).click();
  await expect(page.getByText(/Access suspended\./)).toBeVisible();
  expect((await daniel.page.request.get("/api/home")).status()).toBe(401);
  expect((await daniel.page.request.post("/api/work", { data: { skillId: "00000000-0000-0000-0000-000000000000" }, headers: { origin: "http://localhost:3100" } })).status()).toBe(401);
  await daniel.page.goto("/work");
  await expect(daniel.page).toHaveURL(/\/login/);
  await expect(daniel.page.getByRole("button", { name: /Daniel Kim/ })).toBeDisabled();
  await page.goto("/admin/activity");
  await page.getByLabel("Search").fill("user.suspended");
  await expect(page.locator("td", { hasText: "user.suspended" })).toBeVisible();
  await daniel.context.close();

  // The original interface layout can be restored at any time.
  await page.goto("/admin/interface");
  await page.locator("li", { hasText: "Version 1" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/Restored and published as version 3/)).toBeVisible();
  await loginAs(page, "Maria Lopez");
  await expect(page.getByRole("heading", { name: "What do you need to prepare?" })).toBeVisible();
  await expect(page.locator(".tile").first()).toContainText("Write a Demand Letter");
});

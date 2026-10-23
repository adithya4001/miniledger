import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";

test("MiniLedger working demo: login, receipt, overdue, repayment and persistence", async ({
  page,
}) => {
  const start = Date.now();
  const chapters: { seconds: number; title: string }[] = [];
  const chapter = (title: string) =>
    chapters.push({ seconds: (Date.now() - start) / 1000, title });
  const pause = () => page.waitForTimeout(8125);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir("demo-artifacts", { recursive: true });
  await page.goto("/");
  chapter("Phone login with a mock OTP");
  await expect(page.getByText("Money lent.")).toBeVisible();
  await page.screenshot({ path: "demo-artifacts/01-login.png" });
  await pause();
  await page.getByLabel("Phone number", { exact: true }).fill("+919876543210");
  await pause();
  await page
    .getByRole("button", { name: "Get login code →", exact: true })
    .click();
  await expect(page.getByLabel("Six-digit OTP", { exact: true })).toBeVisible();
  await pause();
  const logs = await readFile("api.log", "utf8");
  const code = [...logs.matchAll(/\[MOCK OTP\] \+919876543210: (\d{6})/g)].at(
    -1,
  )?.[1];
  expect(code).toBeTruthy();
  await page.getByLabel("Six-digit OTP", { exact: true }).fill(code!);
  await page
    .getByRole("button", { name: "Verify & open ledger →", exact: true })
    .click();
  await expect(
    page.getByText("Start on a good note.", { exact: true }),
  ).toBeVisible();
  chapter("Empty ledger and zero totals");
  await page.screenshot({ path: "demo-artifacts/02-empty.png" });
  await pause();
  await page
    .getByRole("button", { name: "+ Add a loan entry", exact: true })
    .click();
  await page.getByLabel("Friend’s name", { exact: true }).fill("Aarav");
  await page.getByLabel("Amount lent (₹)", { exact: true }).fill("1250.50");
  await page
    .getByLabel("Due date (YYYY-MM-DD)", { exact: true })
    .fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  chapter("Add an overdue loan with a receipt");
  await pause();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Attach receipt photo", exact: true })
    .click();
  await (await chooser).setFiles("fixtures/receipt.png");
  await expect(
    page.getByText("✓ Receipt attached · tap to change", { exact: true }),
  ).toBeVisible();
  await pause();
  await page.getByRole("button", { name: "Save entry →", exact: true }).click();
  await expect(page.getByText("Aarav", { exact: true })).toBeVisible();
  await expect(page.getByText("OVERDUE", { exact: true })).toBeVisible();
  await expect(page.getByTestId("outstanding-balance")).toHaveText("₹1,250.50");
  await expect(page.getByTestId("total-overdue")).toHaveText("₹1,250.50");
  await page.screenshot({ path: "demo-artifacts/03-overdue.png" });
  await pause();
  await page
    .getByRole("button", { name: "+ Add a loan entry", exact: true })
    .click();
  await page.getByLabel("Friend’s name", { exact: true }).fill("Meera");
  await page.getByLabel("Amount lent (₹)", { exact: true }).fill("800");
  await page.getByRole("button", { name: "In 7 days", exact: true }).click();
  await pause();
  await page.getByRole("button", { name: "Save entry →", exact: true }).click();
  await expect(page.getByText("Meera", { exact: true })).toBeVisible();
  await expect(page.getByTestId("outstanding-balance")).toHaveText("₹2,050.50");
  chapter("Summary updates and loan filters");
  await page.screenshot({ path: "demo-artifacts/04-dashboard.png" });
  await pause();
  await page.getByRole("button", { name: "Overdue •", exact: true }).click();
  await expect(page.getByText("Aarav", { exact: true })).toBeVisible();
  await expect(page.getByText("Meera", { exact: true })).toHaveCount(0);
  await pause();
  await page
    .getByRole("button", { name: "View receipt for Aarav", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Loan receipt photo", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "demo-artifacts/05-receipt.png" });
  await pause();
  await page
    .getByRole("button", { name: "Close receipt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mark Aarav as repaid", exact: true })
    .click();
  chapter("Confirm repayment and clear overdue balance");
  await pause();
  await page
    .getByRole("button", { name: "Yes, received in full ✓", exact: true })
    .click();
  await expect(
    page.getByText("All clear here.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("outstanding-balance")).toHaveText("₹800");
  await expect(page.getByTestId("total-repaid")).toHaveText("₹1,250.50");
  await expect(page.getByTestId("total-overdue")).toHaveText("₹0");
  await pause();
  await page.getByRole("button", { name: "Repaid", exact: true }).click();
  await expect(page.getByText("REPAID ✓", { exact: true })).toBeVisible();
  await page.screenshot({ path: "demo-artifacts/06-repaid.png" });
  await pause();
  await page.getByRole("button", { name: "All entries", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Meera", { exact: true })).toBeVisible();
  chapter("Refresh preserves the session and database entries");
  await pause();
  await page
    .getByRole("button", { name: "+ Add a loan entry", exact: true })
    .click();
  await page.getByRole("button", { name: "Save entry →", exact: true }).click();
  await expect(
    page.getByText("Enter a friend’s name, up to 80 characters.", {
      exact: true,
    }),
  ).toBeVisible();
  chapter("Input validation and sign out");
  await pause();
  await page
    .getByRole("button", { name: "Close new entry", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Phone number", { exact: true })).toBeVisible();
  const remaining = 145000 - (Date.now() - start);
  if (remaining > 0) await page.waitForTimeout(remaining);
  await page.screenshot({ path: "demo-artifacts/07-signed-out.png" });
  expect(errors).toEqual([]);
  await writeFile(
    "demo-artifacts/chapters.json",
    JSON.stringify(chapters, null, 2),
  );
});

test("desktop layout and a second account have an isolated empty ledger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByLabel("Phone number", { exact: true }).fill("+919876543211");
  await page
    .getByRole("button", { name: "Get login code →", exact: true })
    .click();
  await expect(page.getByLabel("Six-digit OTP", { exact: true })).toBeVisible();
  const logs = await readFile("api.log", "utf8");
  const code = [...logs.matchAll(/\[MOCK OTP\] \+919876543211: (\d{6})/g)].at(
    -1,
  )![1];
  await page.getByLabel("Six-digit OTP", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Verify & open ledger →", exact: true })
    .click();
  await expect(
    page.getByText("Start on a good note.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "demo-artifacts/08-desktop.png" });
});

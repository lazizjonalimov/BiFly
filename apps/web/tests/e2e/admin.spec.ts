import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PASSWORD, completedLoad, fleet, otherPerson, signIn, signUp, unique, viaApp } from "./helpers";

test("revenue for a chosen period, grouped two ways, and downloaded as CSV", async ({ page }) => {
  await signUp(page);
  const s = await fleet(page);
  await completedLoad(page, s, "2500.00", 0);
  await completedLoad(page, s, "1800.00", 1);

  await page.getByRole("link", { name: "Reports" }).click();
  await page.getByRole("link", { name: /^Revenue/ }).click();
  const table = page.getByRole("table", { name: "Revenue" });
  await expect(table.getByRole("row").filter({ hasText: "Globex" })).toContainText("$4,300.00");
  await expect(table.getByRole("row").filter({ hasText: "Globex" })).toContainText("1,840");      // miles

  const period = page.getByRole("group", { name: "Report period" });
  await period.getByLabel("Group").selectOption({ label: "By month" });
  await expect(page).toHaveURL(/group_by=month/);
  await expect(table.getByRole("row").nth(1)).toContainText(new Date().toISOString().slice(0, 7));
  await period.getByLabel("Period").selectOption({ label: "Choose dates" });
  await expect(page.getByLabel("From")).toBeVisible();
  await expect(page).toHaveURL(/period=custom/);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^bifly-revenue-.*\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.replace(/^﻿/, "").split(/\r?\n/)[0]).toBe("Month,Loads,Miles,Revenue,Revenue per mile");
  expect(csv).toContain("4300.00");
});

test("company settings, the role matrix and the audit log", async ({ page, browser }) => {
  const account = await signUp(page, "Settings Freight");
  await page.getByRole("link", { name: "Company settings" }).click();
  await page.getByLabel("Legal name").fill("Settings Freight LLC");
  await page.getByLabel("USDOT number").fill("3141592");
  await page.getByLabel("Invoice number prefix").fill("SF-1");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Use up to 10 letters and digits")).toBeVisible();
  await page.getByLabel("Invoice number prefix").fill("sf");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Company settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Legal name")).toHaveValue("Settings Freight LLC");
  await expect(page.getByLabel("Invoice number prefix")).toHaveValue("SF");

  // A new time zone reloads the workspace so every screen uses it.
  await page.getByLabel("Time zone").selectOption("America/Denver");
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Save settings" }).click()]);
  await expect(page.getByLabel("Time zone")).toHaveValue("America/Denver");
  expect((await viaApp<{ organization: { timezone: string } }>(page, "GET", "/auth/me")).data.organization.timezone).toBe("America/Denver");

  await page.getByRole("link", { name: "Roles" }).click();
  const matrix = page.getByRole("table", { name: "What each role can do" });
  await expect(matrix.getByRole("columnheader", { name: "Dispatcher" })).toBeVisible();
  await expect(matrix.getByRole("row").filter({ hasText: "Assign, reassign and dispatch loads" }).getByLabel("Allowed", { exact: true })).toHaveCount(3);

  await page.getByRole("link", { name: "Audit log" }).click();
  const log = page.getByRole("table", { name: "Audit log" });
  const entry = log.getByRole("row").filter({ hasText: "Organization updated" }).first();
  await expect(entry).toContainText("Olive Owner");
  await entry.click();
  const details = page.getByRole("dialog", { name: "Organization updated" });
  await expect(details.getByText(/"timezone": "America\/Denver"/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Neither is for a dispatcher.
  const dispatcher = { email: `${unique("dispatch")}@example.com`, full_name: "Devon Dispatcher", password: PASSWORD, role: "dispatcher" };
  await viaApp(page, "POST", "/members", dispatcher);
  const other = await otherPerson(browser);
  await signIn(other, dispatcher.email);
  await other.waitForURL(/\/dashboard$/);
  await expect(other.getByRole("link", { name: "Audit log" })).toBeHidden();
  await expect(other.getByRole("link", { name: "Company settings" })).toBeHidden();
  expect((await viaApp(other, "GET", "/audit-logs")).status).toBe(403);
  await other.goto(`/${account.slug}/settings/company`);
  await expect(other.getByText("Only an owner or administrator can change these.")).toBeVisible();
  await expect(other.getByLabel("Legal name")).toBeDisabled();
});

test("the bell shows what needs attention, and counts only what is new since it was opened", async ({ page }) => {
  await signUp(page);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await viaApp(page, "POST", "/drivers", { first_name: "Ed", last_name: "Expired", cdl_expiry: day(-3), medical_cert_expiry: day(300) });
  await page.reload();

  const bell = page.getByRole("button", { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName("Notifications, 1 new");
  await bell.click();
  const alerts = page.getByRole("list", { name: "Alerts" });
  await expect(alerts.getByRole("link", { name: /Drivers who can't be dispatched/ })).toContainText("New");
  await alerts.getByRole("link", { name: /Drivers who can't be dispatched/ }).click();
  await expect(page).toHaveURL(/\/safety\?state=expired&entity_type=driver$/);
  await expect(bell).toHaveAccessibleName("Notifications");                      // seen

  // Something new comes up: only that is counted.
  await viaApp(page, "POST", "/vehicles", { unit_number: "101", insurance_expiry: day(-1), registration_expiry: day(300), inspection_expiry: day(300) });
  await page.reload();
  await expect(bell).toHaveAccessibleName("Notifications, 1 new");
  await bell.click();
  await expect(alerts.getByRole("link", { name: /Equipment that can't be dispatched/ })).toContainText("New");
  await expect(alerts.getByRole("link", { name: /Drivers who can't be dispatched/ })).not.toContainText("New");
});

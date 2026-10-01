import { expect, test } from "@playwright/test";

test("redirects an unauthenticated analyst to the fail-closed sign-in screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "ForgeFlow Intelligence" }),
  ).toBeVisible();
  await expect(
    page.getByText("Google Workspace sign-in has not been configured"),
  ).toBeVisible();
});

import { expect, test } from "@playwright/test";

const workflowId = "11111111-1111-4111-8111-111111111111";
const corsHeaders = {
  "access-control-allow-origin": "http://localhost:3000",
  "access-control-allow-headers": "content-type",
};

test("submits a ticker and renders durable workflow and typed report evidence", async ({
  page,
}) => {
  await page.route("**/workflows/company-analysis", async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: {
        workflowId,
        state: "PENDING",
        createdAt: "2026-09-29T00:00:00.000Z",
      },
    });
  });
  await page.route(`**/workflows/${workflowId}`, async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: {
        id: workflowId,
        ticker: "MSFT",
        state: "RETRYING",
        createdAt: "2026-09-29T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        tasks: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "FETCH_SEC_FILINGS",
            state: "RETRYING",
            attemptCount: 2,
            maxAttempts: 3,
            dependsOn: [],
            nextAttemptAt: null,
            startedAt: null,
            completedAt: null,
            lastErrorCode: "LEASE_EXPIRED",
          },
        ],
      },
    });
  });
  await page.route(`**/reports/${workflowId}`, async (route) => {
    await route.fulfill({
      headers: corsHeaders,
      json: {
        id: "33333333-3333-4333-8333-333333333333",
        workflowId,
        ticker: "MSFT",
        publishedAt: "2026-09-29T00:00:00.000Z",
        items: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "AI_ANALYSIS",
            section: "Outlook",
            title: "Grounded observation",
            content: "The filing provides cited context.",
            sources: [
              {
                sourceId: "55555555-5555-4555-8555-555555555555",
                sourceType: "SEC_FILING",
                provider: "SEC EDGAR",
                url: "https://www.sec.gov/Archives/example",
                retrievedAt: "2026-09-29T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("US ticker").fill("msft");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(
    page.getByRole("heading", { name: "MSFT workflow" }),
  ).toBeVisible();
  await expect(page.getByText("LEASE_EXPIRED")).toBeVisible();
  await expect(page.getByText("AI ANALYSIS")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "SEC EDGAR source" }),
  ).toHaveAttribute("href", "https://www.sec.gov/Archives/example");
});

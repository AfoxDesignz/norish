// A password user adds OIDC under another email in Settings, signs in with it
// to the same account, and removes it again.
import { signIn } from "../harness/auth";
import { expect, IDP_NAME, MEMBER, test } from "./fixture";

test("a password user adds OIDC in Settings, signs in with it, and removes it", async ({
  browser,
  aiStack,
}) => {
  const passwordContext = await browser.newContext({
    baseURL: aiStack.baseURL,
    storageState: { cookies: await signIn(aiStack.baseURL, MEMBER), origins: [] },
  });
  const oidcContext = await browser.newContext({ baseURL: aiStack.baseURL });

  try {
    const page = await passwordContext.newPage();
    const oidcRow = page.getByRole("listitem").filter({ hasText: IDP_NAME });

    await page.goto("/settings");
    await expect(page.getByRole("listitem").filter({ hasText: "Password" })).toBeVisible();

    // Cancelling at the identity provider comes back with nothing added.
    aiStack.idp.signInAs = null;
    await oidcRow.getByRole("button", { name: "Add" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(oidcRow.getByRole("button", { name: "Add" })).toBeVisible();

    aiStack.idp.signInAs = { sub: "member-sub", email: "member@home.lan", name: "Member" };
    await oidcRow.getByRole("button", { name: "Add" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(oidcRow.getByRole("button", { name: "Remove" })).toBeVisible();

    const oidcPage = await oidcContext.newPage();

    await oidcPage.goto("/login");
    await oidcPage.getByRole("button", { name: `Sign in with ${IDP_NAME}` }).click();
    await expect(oidcPage).toHaveURL(/\/$/);

    const session = await (await oidcPage.request.get("/api/auth/get-session")).json();

    expect(session.user.email).toBe(MEMBER.email);

    await oidcPage.goto("/settings");
    const row = oidcPage.getByRole("listitem").filter({ hasText: IDP_NAME });

    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row.getByRole("button", { name: "Add" })).toBeVisible();
  } finally {
    aiStack.idp.signInAs = null;
    await Promise.all([passwordContext.close(), oidcContext.close()]);
  }
});

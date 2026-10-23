// A password user connects OIDC under another email in Settings, signs in with it
// to the same account, and disconnects it again.
import { signIn } from "../harness/auth";
import { expect, IDP_NAME, MEMBER, test } from "./fixture";

test("a password user connects OIDC in Settings, signs in with it, and disconnects it", async ({
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
    const connect = page.getByRole("button", { name: `Connect ${IDP_NAME}` });
    const oidcRow = page.getByRole("listitem").filter({ hasText: IDP_NAME });

    // The server renders the card with its methods, so it never offers a Connect it takes back.
    const html = await (await page.goto("/settings"))?.text();

    expect(html).toContain(">Password</p>");
    expect(html).toContain(`Connect ${IDP_NAME}`);
    await expect(page.getByRole("listitem").filter({ hasText: "Password" })).toBeVisible();

    // Cancelling at the identity provider comes back with nothing added.
    aiStack.idp.signInAs = null;
    await Promise.all([page.waitForURL(/error=access_denied/), connect.click()]);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(connect).toBeVisible();

    aiStack.idp.signInAs = { sub: "member-sub", email: "member@home.lan", name: "Member" };
    await connect.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(oidcRow.getByRole("button", { name: "Disconnect" })).toBeVisible();

    const oidcPage = await oidcContext.newPage();

    await oidcPage.goto("/login");
    await oidcPage.getByRole("button", { name: `Sign in with ${IDP_NAME}` }).click();
    await expect(oidcPage).toHaveURL(/\/$/);

    const session = await (await oidcPage.request.get("/api/auth/get-session")).json();

    expect(session.user.email).toBe(MEMBER.email);

    await oidcPage.goto("/settings");
    await oidcPage
      .getByRole("listitem")
      .filter({ hasText: IDP_NAME })
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect(oidcPage.getByRole("button", { name: `Connect ${IDP_NAME}` })).toBeVisible();
  } finally {
    aiStack.idp.signInAs = null;
    await Promise.all([passwordContext.close(), oidcContext.close()]);
  }
});

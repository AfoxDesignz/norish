import "@/styles/globals.css";

import RegisterServiceWorker from "@/components/register-service-worker";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { appMetadata, appViewport } from "./metadata";
import { AppThemeProvider } from "./providers/theme-provider";

// Signing in or up ends in a full page load, a cross-document view transition. This types it
// `sign-in` for styles/globals.css and skips every other cross-document one.
const SIGN_IN_REVEAL = `addEventListener("pagereveal", (event) => {
  if (!event.viewTransition) return;
  const from = window.navigation?.activation?.from?.url;
  const isAuth = (url) => ["login", "signup"].includes(new URL(url).pathname.split("/")[1]);
  if (from && isAuth(from) && !isAuth(location.href)) event.viewTransition.types.add("sign-in");
  else event.viewTransition.skipTransition();
});`;

export const metadata = appMetadata;
export const viewport = appViewport;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // The settings tabs' messages ship with that route's own provider; other pages keep what
  // their client code reads (the ingredient panels, the AI key prompt).
  const { settings, ...messages } = await getMessages();
  const clientMessages = {
    ...messages,
    settings: {
      ingredients: settings.ingredients,
      admin: { aiProcessing: settings.admin.aiProcessing },
    },
  };

  return (
    <html suppressHydrationWarning lang={locale}>
      <head>
        <meta content="yes" name="apple-mobile-web-app-capable" />
        {/* In the head, so it listens before the page's first render. */}
        <script
          // A constant, and React escapes a script's text children, so it goes in as raw HTML.
          // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
          dangerouslySetInnerHTML={{ __html: SIGN_IN_REVEAL }}
        />
      </head>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <AppThemeProvider>
          <NextIntlClientProvider locale={locale} messages={clientMessages}>
            {children}
          </NextIntlClientProvider>
        </AppThemeProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}

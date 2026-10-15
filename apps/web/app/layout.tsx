import "@/styles/globals.css";

import RegisterServiceWorker from "@/components/register-service-worker";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { appMetadata, appViewport } from "./metadata";
import { AppThemeProvider } from "./providers/theme-provider";

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

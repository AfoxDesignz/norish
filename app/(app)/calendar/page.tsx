"use client";

import { useTranslations } from "next-intl";

import { CalendarContextProvider } from "./context";

export default function CalendarPage() {
  const t = useTranslations("calendar.page");

  return (
    <CalendarContextProvider>
      <div className="flex min-h-0 w-full flex-1 flex-col md:mx-auto md:max-w-7xl md:p-6 lg:p-8">
        <h1 className="mb-4 shrink-0 text-2xl font-bold">{t("title")}</h1>
      </div>
    </CalendarContextProvider>
  );
}

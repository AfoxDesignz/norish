"use client";

import { useTranslations } from "next-intl";

import { CalendarContextProvider } from "./context";

import MonthlyCalendar from "@/app/(app)/calendar/components/monthly-calendar";
import {
  DayTimelineMobile,
  DayTimelineDesktop,
} from "@/app/(app)/calendar/components/day-timeline";

export default function CalendarPage() {
  const t = useTranslations("calendar.page");

  return (
    <CalendarContextProvider>
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="mb-6 flex min-h-10 shrink-0 items-center justify-between">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>

        {/* Mobile */}
        <div className="flex min-h-0 w-full flex-1 flex-col md:hidden">
          <DayTimelineMobile />
        </div>

        {/* Desktop */}
        <div className="hidden min-h-0 w-full flex-1 gap-6 md:grid md:grid-cols-2">
          <div className="h-full">
            <MonthlyCalendar />
          </div>
          <div className="flex h-full min-h-0 flex-col">
            <DayTimelineDesktop />
          </div>
        </div>
      </div>
    </CalendarContextProvider>
  );
}

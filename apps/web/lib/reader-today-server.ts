import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { dateInTimeZone, TIME_ZONE_COOKIE } from "./reader-today";

/** The reader's date for this request, read once: the layout and the page seed the same day. */
export const readReaderToday = cache(async () =>
  dateInTimeZone(new Date(), (await cookies()).get(TIME_ZONE_COOKIE)?.value)
);

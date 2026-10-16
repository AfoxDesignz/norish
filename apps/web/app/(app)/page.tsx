import { getInitialDateRange } from "@/app/(app)/calendar/context-helpers";
import { Dashboard } from "@/components/dashboard/dashboard";
import { QuerySeed } from "@/components/query-seed";
import { readReaderToday } from "@/lib/reader-today-server";

import { dateKey } from "@norish/shared/lib/helpers";

// Signed in by now: the proxy sends anyone else to the login page. A full load carries the week
// Today's meals reads, worked out in the reader's time zone.
export default async function Home() {
  const { start, end } = getInitialDateRange("desktop", await readReaderToday());

  return (
    <QuerySeed
      reads={(trpc, client) => [
        client.query(
          trpc.calendar.listItems.queryOptions({ startISO: dateKey(start), endISO: dateKey(end) })
        ),
      ]}
    >
      <Dashboard />
    </QuerySeed>
  );
}

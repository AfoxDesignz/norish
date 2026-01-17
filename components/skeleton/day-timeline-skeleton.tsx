"use client";

import { Skeleton } from "@heroui/react";

export default function DayTimelineSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={`skel-${i}`} className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-3 w-16 rounded" />
            </div>
          </div>
          <Skeleton className="h-px w-full" />
        </div>
      ))}
    </div>
  );
}

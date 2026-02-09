"use client";

import { ChartDataSyncSection } from "@ui/components/settings/ChartDataSyncSection";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure app preferences and manage data synchronization
        </p>
      </div>

      <div className="space-y-8">
        <section>
          <ChartDataSyncSection />
        </section>
      </div>
    </div>
  );
}


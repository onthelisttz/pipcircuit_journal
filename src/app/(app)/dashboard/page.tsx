export default function DashboardPage() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Connected account data will appear here once sync is configured.
      </p>
    </div>
  );
}

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">You are offline</h1>
      <p className="text-sm text-muted-foreground">
        The app shell is available, but network data cannot be refreshed right now.
        Reconnect to sync latest trades and bars.
      </p>
    </main>
  );
}


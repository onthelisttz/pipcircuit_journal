import { AccountsPageClient, AccountsTable } from "@ui/features/accounts";

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <AccountsPageClient />
      <AccountsTable />
    </div>
  );
}

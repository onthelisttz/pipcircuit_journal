import type { Metadata } from "next";
import { AccountsPageClient, AccountsTable } from "@ui/features/accounts";

export const metadata: Metadata = {
  title: "Accounts",
};

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <AccountsPageClient />
      <AccountsTable />
    </div>
  );
}

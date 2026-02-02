import { LinkCTraderAccountButton } from "@ui/features/accounts";
import { AccountsTable } from "@ui/features/accounts/AccountsTable";

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Link cTrader accounts and manage active account context.
          </p>
        </div>
        <LinkCTraderAccountButton />
      </div>
      <AccountsTable />
    </div>
  );
}

import type { Metadata } from "next";
import { TagsTable } from "@ui/features/tags";

export const metadata: Metadata = {
  title: "Tags",
};

export default function TagsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Tags</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage tags for categorizing trades. Add, edit, or delete tags. Changes apply to all trades.
        </p>
      </div>
      <TagsTable />
    </div>
  );
}

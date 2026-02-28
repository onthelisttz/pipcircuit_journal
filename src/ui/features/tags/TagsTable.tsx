"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2, Plus, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import type { Tag } from "@domain/entities";
import { TagCategory } from "@domain/enums";
import { useTagsList } from "@ui/hooks";
import { ConfirmDialog } from "@ui/components/common";

const CATEGORY_OPTIONS = [
  { value: TagCategory.Strategy, label: "Strategy" },
  { value: TagCategory.Mistakes, label: "Mistakes" },
  { value: TagCategory.Rules, label: "Rules" },
  { value: TagCategory.Custom, label: "Custom" },
];

const PRESET_COLORS = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#6b7280",
];

interface TagFormState {
  name: string;
  category: TagCategory;
  color: string;
}

const emptyForm: TagFormState = {
  name: "",
  category: TagCategory.Custom,
  color: "#3b82f6",
};

type SortBy = "name" | "category";
type SortDir = "asc" | "desc";

export function TagsTable() {
  const { tags, isLoading, error, create, update, remove } = useTagsList();
  const [editing, setEditing] = useState<Tag | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<TagFormState>(emptyForm);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [categoryFilter, setCategoryFilter] = useState<TagCategory | "All">("All");
  const [confirmDelete, setConfirmDelete] = useState<{ id: number } | null>(null);

  const filteredSortedTags = useMemo(() => {
    const filtered =
      categoryFilter === "All"
        ? [...tags]
        : tags.filter((tag) => tag.category === categoryFilter);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const aName = typeof a.name === "string" ? a.name : "";
      const bName = typeof b.name === "string" ? b.name : "";
      const aCategory = typeof a.category === "string" ? a.category : "";
      const bCategory = typeof b.category === "string" ? b.category : "";
      let cmp = 0;
      if (sortBy === "name") {
        cmp = aName.localeCompare(bName, undefined, { sensitivity: "base" });
      } else {
        cmp = aCategory.localeCompare(bCategory, undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [tags, sortBy, sortDir, categoryFilter]);

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ column, label }: { column: SortBy; label: string }) => (
    <th className="px-4 py-3">
      <button
        onClick={() => toggleSort(column)}
        className="flex items-center gap-1 text-left font-medium text-muted-foreground hover:text-foreground"
      >
        {label}
        {sortBy === column ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )
        ) : (
          <ChevronDown className="h-4 w-4 opacity-40" />
        )}
      </button>
    </th>
  );

  const openAdd = () => {
    setAdding(true);
    setForm(emptyForm);
    setEditing(null);
  };

  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setForm({
      name: typeof tag.name === "string" ? tag.name : "",
      category: tag.category,
      color: tag.color,
    });
    setAdding(false);
  };

  const closeModal = () => {
    setAdding(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;

    try {
      if (editing?.id) {
        await update(editing.id, form);
      } else {
        const now = new Date();
        await create({ ...form, createdAt: now, updatedAt: now });
      }
      closeModal();
    } catch {
      // error handled by hook
    }
  };

  const handleDeleteClick = (id: number) => {
    setConfirmDelete({ id });
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeleting(confirmDelete.id);
    try {
      await remove(confirmDelete.id);
      setConfirmDelete(null);
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-destructive sm:p-6">
        {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <h2 className="text-lg font-semibold text-foreground">Tags</h2>
          <div className="flex items-center gap-2">
            <label htmlFor="tag-category-filter" className="text-xs text-muted-foreground">
              Category
            </label>
            <select
              id="tag-category-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as TagCategory | "All")}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              <option value="All">All categories</option>
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add tag
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void handleDeleteConfirm()}
        title="Delete tag"
        message="Delete this tag? It will be removed from all trades."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deleting != null}
      />

      {(adding || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">
              {editing ? "Edit tag" : "Add tag"}
            </h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  placeholder="e.g. Ist Reg"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value as TagCategory }))
                  }
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Color</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className={`h-8 w-8 rounded-full border-2 ${
                        form.color === c ? "border-foreground" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!form.name.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {editing ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {tags.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground sm:p-6">
            No tags yet. Add tags to categorize your trades.
          </div>
        ) : filteredSortedTags.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground sm:p-6">
            No tags found for the selected category.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[400px] w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <SortHeader column="name" label="Name" />
                  <SortHeader column="category" label="Category" />
                  <th className="px-4 py-3">Color</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSortedTags.map((tag) => (
                  <tr key={tag.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{tag.name || "Untitled"}</td>
                    <td className="px-4 py-3">{tag.category}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block h-4 w-4 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="ml-2 text-muted-foreground">{tag.color}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(tag)}
                        className="inline-flex items-center justify-center rounded-lg border border-border p-2 text-foreground hover:bg-accent"
                        aria-label="Edit tag"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => tag.id != null && handleDeleteClick(tag.id)}
                        disabled={deleting === tag.id}
                        className="ml-2 inline-flex items-center justify-center rounded-lg border border-border p-2 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        aria-label="Delete tag"
                      >
                        {deleting === tag.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

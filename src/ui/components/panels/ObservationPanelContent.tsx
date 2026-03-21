"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useObservation } from "@ui/hooks";
import { useObservationCategories } from "@ui/hooks";
import { useObservationRepository } from "@ui/hooks/useObservationRepository";
import { RichTextEditor } from "@ui/components/common";
import { format } from "date-fns";

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(repo: { update: (id: number, u: object) => Promise<unknown> }, id: number, html: string, onDone: () => void) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    repo.update(id, { content: html || "<p></p>", updatedAt: new Date() }).then(onDone);
  }, 800);
}

interface ObservationPanelContentProps {
  observationId: number;
  onClose: () => void;
}

export function ObservationPanelContent({ observationId }: ObservationPanelContentProps) {
  const repo = useObservationRepository();
  const { observation, isLoading, error, refetch } = useObservation(observationId);
  const { categories, refetch: refetchCategories } = useObservationCategories();

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editingNames, setEditingNames] = useState<Record<number, string>>({});

  useEffect(() => {
    if (observation) {
      setTitle(observation.title || "");
      setCategoryId(observation.categoryId ?? null);
      setContent(observation.content || "<p></p>");
    }
  }, [observation]);

  useEffect(() => {
    // Keep local editable names in sync with latest categories
    const map: Record<number, string> = {};
    for (const c of categories) {
      if (c.id != null) {
        map[c.id] = c.name;
      }
    }
    setEditingNames(map);
  }, [categories]);

  const handleSave = useCallback(async () => {
    if (!observation?.id) return;
    setSaving(true);
    try {
      await repo.update(observation.id, {
        title: title.trim(),
        categoryId,
        content: content || "<p></p>",
        updatedAt: new Date(),
      });
      await refetch();
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }, [observation?.id, title, categoryId, content, refetch, repo]);

  const handleAddCategory = useCallback(async () => {
    if (!newCategoryName.trim()) return;
    try {
      const now = new Date();
      const cat = await repo.createCategory({
        name: newCategoryName.trim(),
        color: "#6b7280",
        createdAt: now,
        updatedAt: now,
      });
      await refetchCategories();
      setCategoryId(cat.id ?? null);
      setNewCategoryName("");
      setShowAddCategory(false);
    } catch (err) {
      console.error("Failed to add category:", err);
    }
  }, [newCategoryName, refetchCategories, repo]);

  const handleUpdateCategory = useCallback(
    async (id: number) => {
      const name = editingNames[id]?.trim();
      if (!name) return;
      try {
        const now = new Date();
        await repo.updateCategory(id, { name, updatedAt: now });
        await refetchCategories();
      } catch (err) {
        console.error("Failed to update category:", err);
      }
    },
    [editingNames, refetchCategories, repo]
  );

  const handleDeleteCategory = useCallback(
    async (id: number) => {
      const confirmed = window.confirm(
        "Delete this category? Existing observations using it will keep their category until you change them."
      );
      if (!confirmed) return;
      try {
        await repo.deleteCategory(id);
        // If the current observation used this category, clear it
        if (categoryId === id && observation?.id) {
          setCategoryId(null);
          await repo.update(observation.id, { categoryId: null, updatedAt: new Date() });
          await refetch();
        }
        await refetchCategories();
      } catch (err) {
        console.error("Failed to delete category:", err);
      }
    },
    [categoryId, observation?.id, refetch, refetchCategories, repo]
  );

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !observation) {
    return (
      <div className="p-4">
        <p className="text-sm text-destructive">
          {error?.message ?? "Observation not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Title - editable */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSave}
          placeholder="Observation title"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium"
        />
      </div>

      {/* Category - editable */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Category</label>
        <div className="flex gap-2 flex-wrap">
          <select
            value={categoryId ?? ""}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              setCategoryId(v);
              if (v != null) {
                repo.update(observation.id!, { categoryId: v, updatedAt: new Date() }).then(() => refetch());
              }
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm min-w-[120px]"
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {showAddCategory ? (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm w-32"
                autoFocus
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="rounded-lg bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setShowAddCategory(false); setNewCategoryName(""); }}
                className="rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowAddCategory(true)}
                className="rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                + New
              </button>
              <button
                type="button"
                onClick={() => setManagingCategories((v) => !v)}
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {managingCategories ? "Hide categories" : "Manage"}
              </button>
            </>
          )}
        </div>
        {managingCategories && categories.length > 0 && (
          <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border bg-muted/30 p-2">
            <p className="text-[11px] text-muted-foreground">
              Rename or delete categories. Deleting does not change existing observations; you can
              reassign them later.
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {categories.map((c) =>
                c.id == null ? null : (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded-md bg-background px-2 py-1"
                  >
                    <div
                      className="h-3 w-3 rounded-full border border-border"
                      style={{ backgroundColor: c.color }}
                    />
                    <input
                      type="text"
                      value={editingNames[c.id] ?? c.name}
                      onChange={(e) =>
                        setEditingNames((prev) => ({ ...prev, [c.id!]: e.target.value }))
                      }
                      className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdateCategory(c.id!)}
                      className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(c.id!)}
                      className="rounded border border-destructive px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Meta - created/updated */}
      <div className="text-xs text-muted-foreground pt-1 border-t border-border">
        Created {format(new Date(observation.createdAt), "MMM d, yyyy HH:mm")}
        {observation.updatedAt &&
          String(observation.updatedAt) !== String(observation.createdAt) &&
          ` · Updated ${format(new Date(observation.updatedAt), "MMM d, yyyy HH:mm")}`}
      </div>

      {/* Description - last, with rich editor */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Description</label>
        <RichTextEditor
          value={content}
          onChange={(html) => {
            setContent(html);
            if (observation.id == null) return;
            debouncedSave(repo, observation.id, html, refetch);
          }}
          placeholder="Write your observation…"
          minHeight="180px"
        />
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </div>
      )}
    </div>
  );
}

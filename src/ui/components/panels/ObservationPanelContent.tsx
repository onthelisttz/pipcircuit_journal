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
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);

  useEffect(() => {
    if (observation) {
      setTitle(observation.title || "");
      setCategoryId(observation.categoryId ?? null);
      setContent(observation.content || "<p></p>");
    }
  }, [observation]);

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
            <button
              type="button"
              onClick={() => setShowAddCategory(true)}
              className="rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              + New
            </button>
          )}
        </div>
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

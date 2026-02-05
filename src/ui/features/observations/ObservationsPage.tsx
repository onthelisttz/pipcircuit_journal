"use client";

import { useState, useCallback, useEffect } from "react";
import { subDays } from "date-fns";
import { Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { useObservations } from "@ui/hooks/useObservations";
import { useObservationCategories } from "@ui/hooks/useObservationCategories";
import { useObservationPanel } from "@ui/providers";
import { DexieObservationRepository } from "@infrastructure/db/dexie";
import { ConfirmDialog } from "@ui/components/common";
import { ObservationFormModal } from "./ObservationFormModal";
import { ObservationFilters } from "./ObservationFilters";
import type { ObservationFiltersState } from "./ObservationFilters";
import { format } from "date-fns";

const repo = new DexieObservationRepository();

function stripHtml(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent?.trim() ?? "";
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + "…";
}

const defaultFilters: ObservationFiltersState = {
  from: subDays(new Date(), 30),
  to: new Date(),
  categoryId: null,
};

export function ObservationsPage() {
  const [filters, setFilters] = useState<ObservationFiltersState>(defaultFilters);
  const { observations: filteredObs, isLoading, refetch } = useObservations(filters);
  const { categories, refetch: refetchCategories } = useObservationCategories();
  const { openPanel } = useObservationPanel();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const resetForm = useCallback(() => {
    setTitle("");
    setCategoryId(categories[0]?.id ?? null);
    setContent("");
    setEditingId(null);
    setShowModal(false);
    setNewCategoryName("");
    setShowAddCategory(false);
  }, [categories]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;

      setSaving(true);
      try {
        const now = new Date();
        if (editingId) {
          await repo.update(editingId, { title: title.trim(), categoryId, content: content || "<p></p>", updatedAt: now });
        } else {
          await repo.create({
            title: title.trim(),
            categoryId: categoryId ?? undefined,
            content: content || "<p></p>",
            createdAt: now,
            updatedAt: now,
          });
        }
        await refetch();
        resetForm();
      } catch (err) {
        console.error("Failed to save observation:", err);
      } finally {
        setSaving(false);
      }
    },
    [title, categoryId, content, editingId, refetch, resetForm]
  );

  const handleEdit = useCallback(
    (obs: { id?: number; title: string; categoryId?: number | null; content: string }) => {
      setEditingId(obs.id ?? null);
      setTitle(obs.title);
      setCategoryId(obs.categoryId ?? null);
      setContent(obs.content || "<p></p>");
      setShowModal(true);
    },
    []
  );

  const handleDelete = useCallback(async () => {
    if (deleteId == null) return;
    try {
      await repo.delete(deleteId);
      await refetch();
      setDeleteId(null);
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }, [deleteId, refetch]);

  useEffect(() => {
    const defaultCategoryId = categories[0]?.id ?? null;
    if (categoryId == null && defaultCategoryId != null && !editingId) {
      setCategoryId(defaultCategoryId);
    }
  }, [categories, categoryId, editingId]);

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
  }, [newCategoryName, refetchCategories]);

  const observationIds = filteredObs.map((o) => o.id).filter((id): id is number => id != null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-foreground">Observations</h1>
        <div className="flex flex-wrap items-center gap-3">
          <ObservationFilters filters={filters} onChange={setFilters} categories={categories} />
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Observation
          </button>
        </div>
      </div>

      <ObservationFormModal
        open={showModal}
        onClose={resetForm}
        title={title}
        setTitle={setTitle}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        content={content}
        setContent={setContent}
        categories={categories}
        newCategoryName={newCategoryName}
        setNewCategoryName={setNewCategoryName}
        showAddCategory={showAddCategory}
        setShowAddCategory={setShowAddCategory}
        onAddCategory={handleAddCategory}
        onSubmit={handleSubmit}
        saving={saving}
        isEdit={editingId != null}
      />

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredObs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No observations in this range. Add one or adjust filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {filteredObs.map((obs) => {
              const cat = obs.categoryId ? categories.find((c) => c.id === obs.categoryId) : null;
              const descPreview = truncate(stripHtml(obs.content || ""), 120);

              return (
                <div
                  key={obs.id}
                  onClick={() => obs.id && openPanel(obs.id, observationIds)}
                  className="flex flex-col rounded-lg border border-border p-4 cursor-pointer hover:bg-accent/30 transition-colors"
                >
                  <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{obs.title || "Untitled"}</h3>
                      {cat && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                          style={{
                            backgroundColor: `${cat.color}20`,
                            color: cat.color,
                          }}
                        >
                          {cat.name}
                        </span>
                      )}
                    </div>
                    {descPreview && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {descPreview}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-border" onClick={(e) => e.stopPropagation()}>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(obs.createdAt), "MMM d, yyyy")}
                    </p>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEdit(obs)}
                        className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => obs.id && setDeleteId(obs.id)}
                        className="rounded p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteId != null}
        title="Delete observation?"
        message="This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
}

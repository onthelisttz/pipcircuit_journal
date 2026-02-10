"use client";

import { X } from "lucide-react";
import { RichTextEditor } from "@ui/components/common";

interface ObservationFormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  setTitle: (v: string) => void;
  categoryId: number | null;
  setCategoryId: (v: number | null) => void;
  content: string;
  setContent: (v: string) => void;
  categories: { id?: number; name: string }[];
  newCategoryName: string;
  setNewCategoryName: (v: string) => void;
  showAddCategory: boolean;
  setShowAddCategory: (v: boolean) => void;
  onAddCategory: () => void;
  onManageCategories?: () => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  isEdit: boolean;
}

export function ObservationFormModal({
  open,
  onClose,
  title,
  setTitle,
  categoryId,
  setCategoryId,
  content,
  setContent,
  categories,
  newCategoryName,
  setNewCategoryName,
  showAddCategory,
  setShowAddCategory,
  onAddCategory,
  onManageCategories,
  onSubmit,
  saving,
  isEdit,
}: ObservationFormModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">
            {isEdit ? "Edit Observation" : "New Observation"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 space-y-4">
          <div>
            <label htmlFor="obs-modal-title" className="block text-sm font-medium text-muted-foreground mb-1">
              Title
            </label>
            <input
              id="obs-modal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Observation title"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Category
            </label>
            <div className="flex gap-2 flex-wrap">
              <select
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm min-w-[140px]"
              >
                <option value="">Select category</option>
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
                    placeholder="New category name"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm w-40"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={onAddCategory}
                    className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddCategory(false); setNewCategoryName(""); }}
                    className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowAddCategory(true)}
                    className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    + New category
                  </button>
                  {onManageCategories && (
                    <button
                      type="button"
                      onClick={onManageCategories}
                      className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Manage
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Description
            </label>
            <RichTextEditor
              value={content}
              onChange={setContent}
              placeholder="Write your observation…"
              minHeight="160px"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Update" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

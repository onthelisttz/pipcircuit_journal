"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { TradeNote } from "@domain/entities";
import { createNoteRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

export function useTradeNote(tradeId: number | undefined, initialComment?: string | null) {
  const { user } = useAuth();
  const noteRepo = useMemo(() => createNoteRepository(user?.id), [user?.id]);
  const [note, setNote] = useState<TradeNote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadNote = useCallback(async () => {
    if (!tradeId) return;

    setIsLoading(true);
    setError(null);

    try {
      const notes = await noteRepo.listByTradeId(tradeId);
      const existing = notes.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
      if (existing) {
        setNote(existing);
        return;
      }
      if (initialComment && initialComment.trim()) {
        const created = await noteRepo.create({
          tradeId,
          content: `<p>${escapeHtml(initialComment)}</p>`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        setNote(created);
      } else {
        setNote(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load note"));
      setNote(null);
    } finally {
      setIsLoading(false);
    }
  }, [tradeId, initialComment, noteRepo]);

  useEffect(() => {
    void loadNote();
  }, [loadNote]);

  const saveNote = useCallback(
    async (content: string) => {
      if (!tradeId) return;

      const now = new Date();
      try {
        if (note?.id) {
          const updated = await noteRepo.update(note.id, { content, updatedAt: now });
          setNote(updated);
        } else {
          const created = await noteRepo.create({
            tradeId,
            content: content || "<p></p>",
            createdAt: now,
            updatedAt: now,
          });
          setNote(created);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to save note"));
      }
    },
    [tradeId, note?.id, noteRepo]
  );

  return { note, isLoading, error, saveNote, refetch: loadNote };
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

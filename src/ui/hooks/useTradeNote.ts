"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { TradeNote } from "@domain/entities";
import { createNoteRepository } from "@infrastructure/db/createDualRepositories";
import { db } from "@infrastructure/db/dexie/database";
import { useAuth } from "@ui/hooks/useAuth";

export function useTradeNote(tradeId: number | undefined, initialComment?: string | null) {
  const { user } = useAuth();
  const noteRepo = useMemo(() => createNoteRepository(user?.id), [user?.id]);
  const seededTradeRef = useRef<number | null>(null);
  const liveNotes = useLiveQuery(
    async () => {
      if (!tradeId) return [];
      return db.trade_notes
        .where("tradeId")
        .equals(tradeId)
        .filter((note) => !note.deletedAt)
        .toArray();
    },
    [tradeId, user?.id]
  );
  const note = useMemo<TradeNote | null>(() => {
    const notes = liveNotes ?? [];
    if (notes.length === 0) return null;
    return [...notes].sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0] ?? null;
  }, [liveNotes]);
  const isLoading = Boolean(tradeId) && liveNotes === undefined;
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    seededTradeRef.current = null;
  }, [tradeId]);

  useEffect(() => {
    if (!tradeId || !initialComment?.trim()) return;
    if (liveNotes === undefined) return;
    if (note) return;
    if (seededTradeRef.current === tradeId) return;

    seededTradeRef.current = tradeId;
    void noteRepo
      .create({
        tradeId,
        content: `<p>${escapeHtml(initialComment)}</p>`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error("Failed to seed note"));
      });
  }, [tradeId, initialComment, liveNotes, note, noteRepo]);

  const saveNote = useCallback(
    async (content: string) => {
      if (!tradeId) return;

      const now = new Date();
      try {
        if (note?.id) {
          await noteRepo.update(note.id, { content, updatedAt: now });
        } else {
          await noteRepo.create({
            tradeId,
            content: content || "<p></p>",
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to save note"));
      }
    },
    [tradeId, note, noteRepo]
  );

  const refetch = useCallback(async () => {}, []);

  return { note, isLoading, error, saveNote, refetch };
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

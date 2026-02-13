import { db } from "@infrastructure/db/dexie/database";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isSeedLocalRow(input: { remoteId?: number; clientId?: string }): boolean {
  return input.remoteId == null && !input.clientId;
}

/**
 * Reconciles local seeded tag/category rows that duplicate cloud-backed rows.
 *
 * This targets startup-seeded rows (no remoteId/clientId) and merges them into
 * the matching cloud-backed rows by normalized identity, remapping references.
 */
export async function reconcileSeededJournalDuplicates(): Promise<{
  mergedTags: number;
  mergedCategories: number;
}> {
  let mergedTags = 0;
  let mergedCategories = 0;

  await db.transaction(
    "rw",
    db.tags,
    db.trade_tags,
    db.observation_categories,
    db.observations,
    async () => {
      const tags = await db.tags.toArray();
      const activeTags = tags.filter((tag) => !tag.deletedAt);

      const canonicalTagByKey = new Map<string, number>();
      for (const tag of activeTags) {
        if (tag.id == null || tag.remoteId == null) continue;
        canonicalTagByKey.set(`${normalize(tag.name)}::${tag.category}`, tag.id);
      }

      for (const tag of activeTags) {
        if (tag.id == null || !isSeedLocalRow(tag)) continue;

        const canonicalId = canonicalTagByKey.get(
          `${normalize(tag.name)}::${tag.category}`
        );
        if (canonicalId == null || canonicalId === tag.id) continue;

        const links = await db.trade_tags.where("tagId").equals(tag.id).toArray();
        for (const link of links) {
          if (link.id == null) continue;
          const existing = await db.trade_tags
            .where("[tradeId+tagId]")
            .equals([link.tradeId, canonicalId])
            .first();

          if (existing?.id != null && existing.id !== link.id) {
            if (existing.deletedAt && !link.deletedAt) {
              await db.trade_tags.update(existing.id, { deletedAt: null });
            }
            await db.trade_tags.delete(link.id);
          } else {
            await db.trade_tags.update(link.id, { tagId: canonicalId });
          }
        }

        await db.tags.delete(tag.id);
        mergedTags += 1;
      }

      const categories = await db.observation_categories.toArray();
      const activeCategories = categories.filter((category) => !category.deletedAt);

      const canonicalCategoryByName = new Map<string, number>();
      for (const category of activeCategories) {
        if (category.id == null || category.remoteId == null) continue;
        canonicalCategoryByName.set(normalize(category.name), category.id);
      }

      for (const category of activeCategories) {
        if (category.id == null || !isSeedLocalRow(category)) continue;

        const canonicalId = canonicalCategoryByName.get(normalize(category.name));
        if (canonicalId == null || canonicalId === category.id) continue;

        await db.observations
          .where("categoryId")
          .equals(category.id)
          .modify({ categoryId: canonicalId });

        await db.observation_categories.delete(category.id);
        mergedCategories += 1;
      }
    }
  );

  return { mergedTags, mergedCategories };
}

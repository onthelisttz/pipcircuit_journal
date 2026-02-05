import type { Tag } from "@domain/entities";
import { TagCategory } from "@domain/enums";
import { db } from "./database";

const DEFAULT_TAGS: Omit<Tag, "id">[] = [
  // Strategy
  { name: "Ist Reg", category: TagCategory.Strategy, color: "#3b82f6", createdAt: new Date(), updatedAt: new Date() },
  { name: "2nd Reg", category: TagCategory.Strategy, color: "#10b981", createdAt: new Date(), updatedAt: new Date() },
  { name: "20 pips", category: TagCategory.Strategy, color: "#8b5cf6", createdAt: new Date(), updatedAt: new Date() },
  // Mistakes
  { name: "Early entry", category: TagCategory.Mistakes, color: "#ef4444", createdAt: new Date(), updatedAt: new Date() },
  { name: "Overtrading", category: TagCategory.Mistakes, color: "#f97316", createdAt: new Date(), updatedAt: new Date() },
  { name: "Revenge trading", category: TagCategory.Mistakes, color: "#dc2626", createdAt: new Date(), updatedAt: new Date() },
];

export async function seedDefaultTags(): Promise<void> {
  const count = await db.tags.count();
  if (count > 0) return;

  await db.tags.bulkAdd(DEFAULT_TAGS);
}

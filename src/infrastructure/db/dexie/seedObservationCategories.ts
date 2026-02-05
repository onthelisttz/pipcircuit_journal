import type { ObservationCategory } from "@domain/entities";
import { db } from "./database";

const DEFAULT_CATEGORY: Omit<ObservationCategory, "id"> = {
  name: "General",
  color: "#6b7280",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export async function seedDefaultObservationCategories(): Promise<void> {
  const count = await db.observation_categories.count();
  if (count > 0) return;

  await db.observation_categories.add(DEFAULT_CATEGORY);
}

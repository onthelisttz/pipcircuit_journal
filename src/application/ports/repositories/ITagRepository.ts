import type { Tag, TradeTag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";

export interface ITagRepository {
  getById(id: number): Promise<Tag | null>;
  list(category?: TagCategory): Promise<Tag[]>;
  create(tag: Tag): Promise<Tag>;
  update(id: number, updates: Partial<Tag>): Promise<Tag>;
  delete(id: number): Promise<void>;
  listForTrade(tradeId: number): Promise<Tag[]>;
  addToTrade(tradeId: number, tagId: number): Promise<TradeTag>;
  removeFromTrade(tradeId: number, tagId: number): Promise<void>;
  replaceForTrade(tradeId: number, tagIds: number[]): Promise<void>;
}

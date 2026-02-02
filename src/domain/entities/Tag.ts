import { TagCategory } from "../enums";

export interface Tag {
  id?: number;
  name: string;
  category: TagCategory;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

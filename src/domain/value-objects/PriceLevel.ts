import { ValidationError } from "../errors";

export type PriceLevelType = "take_profit" | "stop_loss" | "entry" | "exit";

export class PriceLevel {
  public readonly price: number;
  public readonly type: PriceLevelType;

  constructor(price: number, type: PriceLevelType) {
    if (!Number.isFinite(price)) {
      throw new ValidationError("Price must be a finite number", "price");
    }

    this.price = price;
    this.type = type;
  }
}

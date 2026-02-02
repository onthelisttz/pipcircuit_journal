import { ValidationError } from "../errors";

export class Symbol {
  public readonly value: string;

  constructor(value: string) {
    if (!value || value.trim().length < 3) {
      throw new ValidationError("Symbol must be at least 3 characters", "symbol");
    }

    this.value = value.trim().toUpperCase();
  }

  toString(): string {
    return this.value;
  }
}

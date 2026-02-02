import { DomainError } from "./DomainError";

export class ValidationError extends DomainError {
  public readonly field?: string;

  constructor(message: string, field?: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
    this.field = field;
  }
}

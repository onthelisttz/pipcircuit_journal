import { ValidationError } from "../errors";

export class TimeRange {
  public readonly start: Date;
  public readonly end: Date;

  constructor(start: Date, end: Date) {
    if (!(start instanceof Date) || Number.isNaN(start.valueOf())) {
      throw new ValidationError("Start must be a valid date", "start");
    }
    if (!(end instanceof Date) || Number.isNaN(end.valueOf())) {
      throw new ValidationError("End must be a valid date", "end");
    }
    if (start.getTime() > end.getTime()) {
      throw new ValidationError("Start must be before end", "start");
    }

    this.start = start;
    this.end = end;
  }

  durationMs(): number {
    return this.end.getTime() - this.start.getTime();
  }

  contains(date: Date): boolean {
    return date.getTime() >= this.start.getTime() && date.getTime() <= this.end.getTime();
  }
}

import { ValidationError } from "../errors";

export class DateRange {
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

  contains(date: Date): boolean {
    const time = date.getTime();
    return time >= this.start.getTime() && time <= this.end.getTime();
  }

  toISOStringRange(): { start: string; end: string } {
    return { start: this.start.toISOString(), end: this.end.toISOString() };
  }
}

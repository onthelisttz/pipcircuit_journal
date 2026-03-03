export const APP_ALL_TIME_START_DATE = new Date(2024, 0, 1);

export function clampDateToAllTimeStart(date: Date): Date {
  if (date.getTime() < APP_ALL_TIME_START_DATE.getTime()) {
    return new Date(APP_ALL_TIME_START_DATE);
  }
  return date;
}

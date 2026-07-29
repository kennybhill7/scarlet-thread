export function toIsoTimestamp(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Database returned an invalid timestamp");
  }
  return parsed.toISOString();
}

export function toOptionalIsoTimestamp(value: string | Date | null) {
  return value === null ? null : toIsoTimestamp(value);
}

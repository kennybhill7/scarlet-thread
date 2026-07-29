export function hasDatabaseErrorCode(error: unknown, code: string) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return false;
    if (
      "code" in current &&
      typeof current.code === "string" &&
      current.code === code
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

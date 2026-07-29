export function isAllowedEmail(
  email: string | null | undefined,
  configuredEmail = process.env.AUTH_ALLOWED_EMAIL,
) {
  const allowedEmail = configuredEmail?.trim().toLowerCase();
  return Boolean(
    allowedEmail && email?.trim().toLowerCase() === allowedEmail,
  );
}

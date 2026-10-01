export function isAllowedWorkspaceIdentity(
  email: string | null | undefined,
  emailVerified: boolean | null | undefined,
  workspaceDomain: string | undefined,
  allowedTestEmail: string | undefined = undefined,
  isDevelopment = process.env.NODE_ENV === "development",
): boolean {
  const normalizedDomain = workspaceDomain?.trim().toLowerCase();
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail || !emailVerified) {
    return false;
  }
  if (normalizedDomain) {
    return normalizedEmail.endsWith(`@${normalizedDomain}`);
  }
  return (
    isDevelopment && normalizedEmail === allowedTestEmail?.trim().toLowerCase()
  );
}

export function isAllowedWorkspaceIdentity(
  email: string | null | undefined,
  emailVerified: boolean | null | undefined,
  workspaceDomain: string | undefined,
): boolean {
  const normalizedDomain = workspaceDomain?.trim().toLowerCase();
  if (!email || !emailVerified || !normalizedDomain) {
    return false;
  }

  return email.trim().toLowerCase().endsWith(`@${normalizedDomain}`);
}

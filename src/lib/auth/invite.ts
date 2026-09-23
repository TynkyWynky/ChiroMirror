import type { SiteRole } from "./access.ts";

export interface InviteInput { email: string; fullName: string; role: SiteRole }
export type ValidationResult<T> = { success: true; data: T } | { success: false; message: string };

/** Validate unknown input before privileged operations; omitted roles grant no SITE rights. */
export function validateInviteInput(input: unknown): ValidationResult<InviteInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, message: "Ongeldige uitnodiging." };
  }
  const { email, fullName, role } = input as { email?: unknown; fullName?: unknown; role?: unknown };
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { success: false, message: "Een geldig e-mailadres is verplicht." };
  }
  if (fullName !== undefined && (typeof fullName !== "string" || fullName.trim().length > 120)) {
    return { success: false, message: "Ongeldige naam (maximaal 120 tekens)." };
  }
  if (role !== undefined && role !== "none" && role !== "editor" && role !== "admin") {
    return { success: false, message: "Ongeldige SITE-toegang." };
  }
  return { success: true, data: {
    email: email.trim().toLowerCase(), fullName: typeof fullName === "string" ? fullName.trim() : "", role: role ?? "none"
  } };
}

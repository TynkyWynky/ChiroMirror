import { validateInviteInput } from "../lib/auth/invite.ts";
import { hasAppPermission } from "../features/app/access.ts";
import type { AppAccess, AppRoleKey } from "../features/app/types.ts";

// Dependency boundary makes authentication/authorization testable without sending email.
export interface AppInviteServices {
  getActor: (token: string) => Promise<string | null>;
  getAccess: (token: string) => Promise<AppAccess>;
  invite: (email: string, fullName: string) => Promise<{ userId: string | null; error: string | null }>;
  getMember: (token: string, memberId: string) => Promise<{ user_id: string | null } | null>;
  complete: (token: string, memberId: string, userId: string, roles: AppRoleKey[]) => Promise<void>;
}
export async function handleAppInvite(request: Request, services: AppInviteServices): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return Response.json({ message: "Ongeldig sessietoken." }, { status: 401 });
  try {
    if (!await services.getActor(token)) return Response.json({ message: "Meld je opnieuw aan." }, { status: 401 });
    const access = await services.getAccess(token);
    if (!hasAppPermission(access.permissions, "members.manage") || !hasAppPermission(access.permissions, "roles.manage")) {
      return Response.json({ message: "Je hebt geen toestemming om APP-accounts uit te nodigen." }, { status: 403 });
    }
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ message: "Ongeldig verzoek." }, { status: 400 }); }
    const validated = validateInviteInput(body);
    if (!validated.success || validated.data.role !== "none") return Response.json({ message: "Vul een geldige naam en een geldig e-mailadres in. Hier kunnen geen SITE-rollen worden toegekend." }, { status: 400 });
    const selection = body as { memberId?: unknown; roles?: unknown };
    const allowedRoles: AppRoleKey[] = ["APP_ADMIN", "RESPONSIBLE", "TREASURER", "MEMBER"];
    if (typeof selection.memberId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.memberId)
      || !Array.isArray(selection.roles) || !selection.roles.length || selection.roles.length > 4
      || !selection.roles.every(role => allowedRoles.includes(role))) {
      return Response.json({ message: "Kies een bestaand lid en minstens één geldige APP-rol." }, { status: 400 });
    }
    const member = await services.getMember(token, selection.memberId);
    if (!member || member.user_id) return Response.json({ message: "Dit lid bestaat niet of heeft al een account. Ververs de lijst." }, { status: 409 });
    const result = await services.invite(validated.data.email, validated.data.fullName);
    if (result.error || !result.userId) return Response.json({ message: "De uitnodiging is mislukt. Controleer of het account al bestaat en ververs de lijst voordat je opnieuw probeert." }, { status: 400 });
    try {
      await services.complete(token, selection.memberId, result.userId, selection.roles as AppRoleKey[]);
    } catch {
      return Response.json({ userId: result.userId, message: `Uitnodiging verstuurd, maar de koppeling en rollen zijn niet opgeslagen. Account-ID: ${result.userId}. Ververs de accounts, controleer de identiteit en voltooi de koppeling en rollen handmatig. Verstuur de uitnodiging niet opnieuw.` }, { status: 409 });
    }
    return Response.json({ userId: result.userId, message: "Uitnodiging verstuurd, account gekoppeld en APP-rollen opgeslagen." });
  } catch { return Response.json({ message: "Je APP-toegang kon niet worden gecontroleerd. Probeer later opnieuw." }, { status: 503 }); }
}

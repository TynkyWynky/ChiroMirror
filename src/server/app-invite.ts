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
  if (!token) return Response.json({ message: "Jeton de session invalide." }, { status: 401 });
  try {
    if (!await services.getActor(token)) return Response.json({ message: "Reconnectez-vous." }, { status: 401 });
    const access = await services.getAccess(token);
    if (!hasAppPermission(access.permissions, "members.manage") || !hasAppPermission(access.permissions, "roles.manage")) {
      return Response.json({ message: "Vous n’avez pas l’autorisation d’inviter des comptes APP." }, { status: 403 });
    }
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ message: "Requête invalide." }, { status: 400 }); }
    const validated = validateInviteInput(body);
    if (!validated.success || validated.data.role !== "none") return Response.json({ message: "Saisissez un nom et un email valides. Aucun rôle SITE ne peut être attribué ici." }, { status: 400 });
    const selection = body as { memberId?: unknown; roles?: unknown };
    const allowedRoles: AppRoleKey[] = ["APP_ADMIN", "RESPONSIBLE", "TREASURER", "MEMBER"];
    if (typeof selection.memberId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.memberId)
      || !Array.isArray(selection.roles) || !selection.roles.length || selection.roles.length > 4
      || !selection.roles.every(role => allowedRoles.includes(role))) {
      return Response.json({ message: "Choisissez un membre existant et au moins un rôle APP valide." }, { status: 400 });
    }
    const member = await services.getMember(token, selection.memberId);
    if (!member || member.user_id) return Response.json({ message: "Ce membre n’existe pas ou possède déjà un compte. Actualisez la liste." }, { status: 409 });
    const result = await services.invite(validated.data.email, validated.data.fullName);
    if (result.error || !result.userId) return Response.json({ message: "L’invitation a échoué. Vérifiez si le compte existe déjà et actualisez la liste avant de réessayer." }, { status: 400 });
    try {
      await services.complete(token, selection.memberId, result.userId, selection.roles as AppRoleKey[]);
    } catch {
      return Response.json({ userId: result.userId, message: `Invitation envoyée, mais la liaison et les rôles n’ont pas été enregistrés. Identifiant du compte : ${result.userId}. Actualisez les comptes, vérifiez l’identité et terminez manuellement la liaison et les rôles. Ne renvoyez pas l’invitation.` }, { status: 409 });
    }
    return Response.json({ userId: result.userId, message: "Invitation envoyée, compte lié et rôles APP enregistrés." });
  } catch { return Response.json({ message: "Impossible de vérifier les accès APP. Réessayez plus tard." }, { status: 503 }); }
}

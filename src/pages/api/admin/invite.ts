import type { APIRoute } from "astro";
import { createServiceClient } from "@/server/supabase";
import { getAdminAuthActionPath } from "@/lib/admin-path";
import { toPublicSiteUrl } from "@/lib/site-url";

import { validateInviteInput } from "@/lib/auth/invite";
import { hasPermission, parseSiteRole } from "@/lib/auth/access";


export const POST: APIRoute = async ({ request }) => {
  const supabase = createServiceClient();

  if (!supabase) {
    return Response.json({ message: "Supabase serverconfig ontbreekt." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return Response.json({ message: "Geen sessietoken ontvangen." }, { status: 401 });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return Response.json({ message: "Sessie kon niet gevalideerd worden." }, { status: 401 });
  }

  const { data: actorProfile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError || !hasPermission(actorProfile ? { role: parseSiteRole(actorProfile.role), managedGroupSlugs: [] } : null, "site.team.manage")) {
    return Response.json({ message: "Alleen admins kunnen uitnodigingen versturen." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "De aanvraag kon niet gelezen worden." }, { status: 400 });
  }

  const validated = validateInviteInput(body);
  if (!validated.success) return Response.json({ message: validated.message }, { status: 400 });
  const { email, fullName, role } = validated.data;

  const redirectTo = toPublicSiteUrl(getAdminAuthActionPath());
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo
  });

  if (inviteError) {
    return Response.json({ message: inviteError.message }, { status: 400 });
  }

  if (inviteData.user?.id) {
    const { error: upsertError } = await supabase.from("profiles").upsert(
      {
        user_id: inviteData.user.id,
        email,
        full_name: fullName,
        role
      },
      { onConflict: "user_id" }
    );

    if (upsertError) {
      return Response.json({ message: upsertError.message }, { status: 400 });
    }
  }

  return Response.json({
    message: "Uitnodiging verstuurd. De leider krijgt een mail en komt daarna automatisch op de wachtwoordpagina terecht."
  });
};

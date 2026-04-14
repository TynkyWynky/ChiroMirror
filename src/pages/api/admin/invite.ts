import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { toPublicSiteUrl } from "@/lib/site-url";

type InvitePayload = {
  email?: string;
  fullName?: string;
  role?: "admin" | "editor";
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createServiceClient() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

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

  if (profileError || actorProfile?.role !== "admin") {
    return Response.json({ message: "Alleen admins kunnen uitnodigingen versturen." }, { status: 403 });
  }

  let body: InvitePayload;
  try {
    body = (await request.json()) as InvitePayload;
  } catch {
    return Response.json({ message: "De aanvraag kon niet gelezen worden." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const fullName = body.fullName?.trim() ?? "";
  const role = body.role === "admin" ? "admin" : "editor";

  if (!email || !EMAIL_PATTERN.test(email)) {
    return Response.json({ message: "Een geldig e-mailadres is verplicht." }, { status: 400 });
  }

  if (fullName.length > 120) {
    return Response.json({ message: "De naam is te lang." }, { status: 400 });
  }

  const redirectTo = toPublicSiteUrl("/admin/auth-action/");
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

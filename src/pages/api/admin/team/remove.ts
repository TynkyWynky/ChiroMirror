import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

type RemoveTeamMemberPayload = {
  userId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return Response.json({ message: "Alleen admins kunnen teamleden verwijderen." }, { status: 403 });
  }

  let body: RemoveTeamMemberPayload;
  try {
    body = (await request.json()) as RemoveTeamMemberPayload;
  } catch {
    return Response.json({ message: "De aanvraag kon niet gelezen worden." }, { status: 400 });
  }

  const userId = body.userId?.trim() ?? "";

  if (!UUID_PATTERN.test(userId)) {
    return Response.json({ message: "Ongeldige gebruiker geselecteerd." }, { status: 400 });
  }

  if (userId === authData.user.id) {
    return Response.json({ message: "Je kunt jezelf niet uit het team verwijderen." }, { status: 400 });
  }

  const { data: targetProfile, error: targetProfileError } = await supabase
    .from("profiles")
    .select("user_id, role, full_name, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (targetProfileError) {
    return Response.json({ message: targetProfileError.message }, { status: 400 });
  }

  if (!targetProfile) {
    return Response.json({ message: "Dit teamlid bestaat niet meer of is al verwijderd." }, { status: 404 });
  }

  if (targetProfile.role === "admin") {
    const { count, error: adminCountError } = await supabase
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");

    if (adminCountError) {
      return Response.json({ message: adminCountError.message }, { status: 400 });
    }

    if ((count ?? 0) <= 1) {
      return Response.json(
        { message: "Je moet minstens 1 admin overhouden in het team." },
        { status: 400 }
      );
    }
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

  if (deleteError) {
    return Response.json({ message: deleteError.message }, { status: 400 });
  }

  const label = targetProfile.full_name?.trim() || targetProfile.email || "Het teamlid";
  return Response.json({ message: `${label} is uit het team verwijderd.` });
};

import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/server/supabase";
import { handleAppInvite } from "@/server/app-invite";
import { loadAppAccess } from "@/features/app/data";
import { getAdminAuthActionPath } from "@/lib/admin-path";
import { toPublicSiteUrl } from "@/lib/site-url";

export const POST: APIRoute = async ({ request }) => {
  const service = createServiceClient();
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!service || !url || !key) return Response.json({ message: "Configuration serveur Supabase manquante." }, { status: 503 });
  const actorClient = (token: string) => createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return handleAppInvite(request, {
    getActor: async token => {
      const { data, error } = await service.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    getAccess: token => loadAppAccess(actorClient(token)),
    getMember: async (token, memberId) => {
      const { data, error } = await actorClient(token).from("members").select("user_id").eq("id", memberId).maybeSingle();
      if (error) throw error;
      return data;
    },
    complete: async (token, memberId, userId, roles) => {
      const { error } = await actorClient(token).rpc("complete_app_member_invitation", {
        target_member_id: memberId, target_user_id: userId, role_keys: roles
      });
      if (error) throw error;
    },
    invite: async (email, fullName) => {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName }, redirectTo: toPublicSiteUrl(getAdminAuthActionPath())
      });
      // The Phase 0 Auth trigger creates a neutral profile; never upsert an existing SITE role here.
      return { userId: data.user?.id ?? null, error: error?.message ?? null };
    }
  });
};

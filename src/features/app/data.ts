import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOnline, networkError } from "./pwa/network.ts";
import { hasAppPermission } from "./access.ts";
import type { AppAccess, AppAccount, AppPermission, AppRole, AppRoleKey, AppUserRole, Member, MemberInput } from "./types.ts";

export const roleLabels: Record<AppRoleKey, string> = { APP_ADMIN: "APP-beheerder", RESPONSIBLE: "Verantwoordelijke", TREASURER: "Financiën", MEMBER: "Leiding" };
export const roleDescriptions: Record<AppRoleKey, string> = {
  MEMBER: "Standaardtoegang voor een lid van de leiding.",
  RESPONSIBLE: "Kan activiteiten organiseren en bepaalde taken beheren.",
  TREASURER: "Kan financiële verrichtingen voor de Chiro beheren.",
  APP_ADMIN: "Kan leden, APP-rollen en app-instellingen beheren."
};
const localizedRole = (role: AppRole): AppRole => ({ ...role, label: roleLabels[role.key] ?? role.label });

export async function loadAppAccess(client: SupabaseClient): Promise<AppAccess> {
  const { data, error } = await client.rpc("get_my_app_access");
  if (error) throw error;
  if (!data || !Array.isArray(data.permissions) || !Array.isArray(data.roles)) throw new Error("Je APP-toegang kon niet worden geladen.");
  return { ...data, roles: (data.roles as AppRole[]).map(localizedRole) } as AppAccess;
}

// Supabase normally caps results at 1,000 rows. Read every page with stable ordering.
async function readPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await page(from, from + 499);
    if (error) throw error;
    result.push(...(data ?? []));
    if (!data || data.length < 500) return result;
  }
}

export async function loadMembersData(client: SupabaseClient, permissions: AppPermission[]) {
  const canReadRoles = hasAppPermission(permissions, "roles.read");
  const canReadAccounts = hasAppPermission(permissions, "members.manage") || hasAppPermission(permissions, "roles.manage");
  const [members, accounts, roles, assignments] = await Promise.all([
    readPages<Member>((from, to) => client.from("members").select("*").order("last_name").order("first_name").order("id").range(from, to)),
    canReadAccounts ? readPages<AppAccount>((from, to) => client.rpc("list_app_accounts").range(from, to)) : Promise.resolve([]),
    canReadRoles ? readPages<AppRole>((from, to) => client.from("app_roles").select("*").order("key").range(from, to)) : Promise.resolve([]),
    canReadRoles ? readPages<AppUserRole>((from, to) => client.from("app_user_roles").select("*").order("user_id").order("role_key").range(from, to)) : Promise.resolve([])
  ]);
  return { members, accounts, roles: roles.map(localizedRole), assignments };
}

export function validateMember(input: MemberInput): MemberInput {
  const first_name = input.first_name.trim(), last_name = input.last_name.trim();
  if (!first_name || !last_name || [...first_name].length > 100 || [...last_name].length > 100) {
    throw new Error("Vul een voornaam en achternaam in (maximaal 100 tekens).");
  }
  if (input.user_id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.user_id)) {
    throw new Error("Kies een geldig account.");
  }
  if (typeof input.active !== "boolean") throw new Error("Ongeldige status.");
  return { first_name, last_name, user_id: input.user_id, active: input.active };
}

export async function saveMember(client: SupabaseClient, id: string | null, input: MemberInput): Promise<Member> {
  requireOnline();
  const values = validateMember(input);
  const query = id ? client.from("members").update(values).eq("id", id) : client.from("members").insert(values);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data as Member;
}
export async function setMemberActive(client: SupabaseClient, id: string, active: boolean) {
  requireOnline();
  const { error } = await client.from("members").update({ active }).eq("id", id).select("id").single();
  if (error) throw error;
}
export async function saveAccountRoles(client: SupabaseClient, userId: string, roles: AppRoleKey[]) {
  requireOnline();
  const { error } = await client.rpc("set_app_user_roles", { target_user_id: userId, role_keys: roles });
  if (error) throw error;
}
export function appError(error: unknown): string {
  const network = networkError(error); if(network)return network;
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "23505") return "Dit account is al gekoppeld aan een ander lid. Ververs de lijst.";
    if (error.code === "23514") return "Controleer de gegevens. Er moet minstens één APP-beheerder blijven.";
    if (error.code === "42501" || error.code === "PGRST116") return "Geen toegang of gewijzigde gegevens. Ververs je toegangsrechten.";
  }
  return error instanceof Error ? error.message : "De actie is mislukt. Ververs de gegevens en probeer opnieuw.";
}

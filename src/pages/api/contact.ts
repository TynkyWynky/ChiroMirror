import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

type ContactPayload = {
  name?: string;
  email?: string;
  subject?: string;
  category?: string;
  message?: string;
  website?: string;
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

function json(message: string, status = 200) {
  return Response.json(
    { message },
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json("Ongeldig aanvraagformaat.", 415);
  }

  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (origin && origin !== requestOrigin) {
    return json("Deze aanvraag is niet toegelaten.", 403);
  }

  let body: ContactPayload;
  try {
    body = (await request.json()) as ContactPayload;
  } catch {
    return json("De aanvraag kon niet gelezen worden.", 400);
  }

  if (clean(body.website)) {
    return json("Bericht goed ontvangen.");
  }

  const payload = {
    name: clean(body.name),
    email: clean(body.email).toLowerCase(),
    subject: clean(body.subject),
    category: clean(body.category),
    message: clean(body.message)
  };

  if (
    payload.name.length < 1 ||
    payload.name.length > 120 ||
    !EMAIL_PATTERN.test(payload.email) ||
    payload.subject.length < 1 ||
    payload.subject.length > 160 ||
    payload.category.length < 1 ||
    payload.category.length > 80 ||
    payload.message.length < 1 ||
    payload.message.length > 5000
  ) {
    return json("Vul alle verplichte velden correct in.", 400);
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return json("Het contactformulier is nog niet volledig geconfigureerd.", 500);
  }

  const { error } = await supabase.from("contact_messages").insert(payload);

  if (error) {
    console.error("Contact message insert failed.", error);
    return json("Opslaan van het bericht lukte niet. Probeer later opnieuw.", 500);
  }

  return json("Bericht goed ontvangen.");
};

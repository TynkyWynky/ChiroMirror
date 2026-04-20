import { useEffect, useState } from "preact/hooks";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";

type AuthActionType = "invite" | "recovery";

const publicSupabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const publicSupabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const REMEMBER_LOGIN_STORAGE_KEY = "chiro-admin-remember-login";

function getSupabaseStorageKey(url: string) {
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "sb-admin-auth-token";
  }
}

function getBrowserStorage(kind: "local" | "session") {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function getRememberLoginPreference() {
  const storage = getBrowserStorage("local");

  try {
    return storage?.getItem(REMEMBER_LOGIN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getRedirectStorage() {
  if (getRememberLoginPreference()) {
    return getBrowserStorage("local") ?? getBrowserStorage("session");
  }

  return getBrowserStorage("session") ?? getBrowserStorage("local");
}

function getActionType(value: string | null): AuthActionType | null {
  return value === "invite" || value === "recovery" ? value : null;
}

function getAuthActionCopy(type: AuthActionType) {
  return type === "recovery"
    ? {
        eyebrow: "Wachtwoord herstel",
        title: "Je herstelmail wordt verwerkt",
        body: "We controleren je link en sturen je daarna meteen door om een nieuw wachtwoord te kiezen."
      }
    : {
        eyebrow: "Leiding uitnodiging",
        title: "Je uitnodiging wordt verwerkt",
        body: "We controleren je uitnodiging en sturen je daarna meteen door om je wachtwoord in te stellen."
      };
}

export default function AdminAuthAction(props: { adminBasePath: string }) {
  const [copy, setCopy] = useState(() => getAuthActionCopy("invite"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicSupabaseUrl || !publicSupabaseAnonKey) {
      setError("De admin-login is nog niet volledig geconfigureerd.");
      return;
    }

    const storage = getRedirectStorage();
    if (!storage) {
      setError("De browseropslag is niet beschikbaar op dit toestel. Open de link opnieuw in een gewone browser.");
      return;
    }

    const supabase = createClient(publicSupabaseUrl, publicSupabaseAnonKey, {
      auth: {
        persistSession: true,
        storageKey: getSupabaseStorageKey(publicSupabaseUrl),
        storage
      }
    });

    async function processAuthAction() {
      try {
        const url = new URL(window.location.href);
        const searchType = getActionType(url.searchParams.get("type"));
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
        const hashType = getActionType(hashParams.get("type"));
        const actionType = searchType ?? hashType ?? "invite";
        const tokenHash = url.searchParams.get("token_hash");
        const code = url.searchParams.get("code");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        setCopy(getAuthActionCopy(actionType));

        if (tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: actionType as EmailOtpType
          });

          if (verifyError) {
            throw verifyError;
          }
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (sessionError) {
            throw sessionError;
          }
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            throw exchangeError;
          }
        } else {
          throw new Error("Deze link is onvolledig of verlopen. Vraag een nieuwe uitnodiging of resetmail.");
        }

        window.location.replace(`${props.adminBasePath}?type=${actionType}`);
      } catch (currentError) {
        console.error("Admin auth action failed.", currentError);
        setError(
          currentError instanceof Error
            ? currentError.message
            : "De uitnodiging of resetlink kon niet verwerkt worden."
        );
      }
    }

    void processAuthAction();
  }, []);

  return (
    <div class="admin-app admin-auth-wrap">
      <div class="admin-auth-card">
        <p class="admin-kicker">{copy.eyebrow}</p>
        <h1>{error ? "De link kon niet verwerkt worden" : copy.title}</h1>
        <p class="muted">{error ?? copy.body}</p>
        {error ? (
          <div class="admin-auth-actions">
            <a class="btn" href={props.adminBasePath}>
              Naar admin-login
            </a>
          </div>
        ) : (
          <div class="admin-loading-inline">Even geduld, je wordt doorgestuurd...</div>
        )}
      </div>
    </div>
  );
}

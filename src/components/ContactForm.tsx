import { useState } from "preact/hooks";

interface ContactFormProps {
  categories: string[];
  successMessage: string;
  errorMessage: string;
  fallbackEmail: string;
}

interface FormState {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  website: string;
}

const initialState = (categories: string[]): FormState => ({
  name: "",
  email: "",
  subject: "",
  category: categories[0] ?? "",
  message: "",
  website: ""
});

export default function ContactForm({
  categories,
  successMessage,
  errorMessage,
  fallbackEmail
}: ContactFormProps) {
  const [form, setForm] = useState<FormState>(initialState(categories));
  const [status, setStatus] = useState<"idle" | "success" | "error" | "loading">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setStatusMessage("");
    setStatus("loading");

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      subject: form.subject.trim(),
      category: form.category.trim(),
      message: form.message.trim(),
      website: form.website.trim()
    };

    if (
      !payload.name ||
      !payload.email ||
      !payload.subject ||
      !payload.category ||
      !payload.message
    ) {
      setStatus("error");
      setStatusMessage(errorMessage);
      return;
    }

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setStatus("error");
        setStatusMessage(result?.message || errorMessage);
        return;
      }

      setForm(initialState(categories));
      setStatus("success");
      setStatusMessage(result?.message || successMessage);
    } catch (error) {
      console.error("Contact message could not be stored.", error);
      setStatus("error");
      setStatusMessage(errorMessage);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="contact-name">Uw naam *</label>
      <input
        id="contact-name"
        required
        value={form.name}
        disabled={status === "loading"}
        onInput={(event) => setForm((current) => ({ ...current, name: (event.target as HTMLInputElement).value }))}
      />

      <label htmlFor="contact-email">Uw e-mailadres *</label>
      <input
        id="contact-email"
        required
        type="email"
        value={form.email}
        disabled={status === "loading"}
        onInput={(event) => setForm((current) => ({ ...current, email: (event.target as HTMLInputElement).value }))}
      />

      <label htmlFor="contact-subject">Onderwerp *</label>
      <input
        id="contact-subject"
        required
        value={form.subject}
        disabled={status === "loading"}
        onInput={(event) =>
          setForm((current) => ({ ...current, subject: (event.target as HTMLInputElement).value }))
        }
      />

      <label htmlFor="contact-category">Categorie *</label>
      <select
        id="contact-category"
        required
        value={form.category}
        disabled={status === "loading"}
        onInput={(event) =>
          setForm((current) => ({ ...current, category: (event.target as HTMLSelectElement).value }))
        }
      >
        {categories.map((category) => (
          <option value={category}>{category}</option>
        ))}
      </select>

      <label htmlFor="contact-message">Bericht *</label>
      <textarea
        id="contact-message"
        required
        rows={6}
        value={form.message}
        disabled={status === "loading"}
        onInput={(event) =>
          setForm((current) => ({ ...current, message: (event.target as HTMLTextAreaElement).value }))
        }
      />

      <label htmlFor="contact-website" style={{ display: "none" }}>
        Website
      </label>
      <input
        id="contact-website"
        tabIndex={-1}
        autoComplete="off"
        value={form.website}
        style={{ display: "none" }}
        onInput={(event) =>
          setForm((current) => ({ ...current, website: (event.target as HTMLInputElement).value }))
        }
      />

      <button class="btn" type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Verzenden..." : "Verstuur"}
      </button>

      <div class="contact-status">
        Rechtstreeks mailen kan altijd via <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>.
      </div>

      {status === "success" && (
        <div class="contact-status contact-status-success">{statusMessage || successMessage}</div>
      )}
      {status === "error" && (
        <div class="contact-status contact-status-error">{statusMessage || errorMessage}</div>
      )}
    </form>
  );
}

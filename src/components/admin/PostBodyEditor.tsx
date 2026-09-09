import { useMemo, useRef, useState } from "preact/hooks";
import { getPostImages, imageToMarkdown, renderPostMarkdown } from "@/lib/post-markdown";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const maxImageSize = 15 * 1024 * 1024;

interface Props {
  value: string;
  disabled: boolean;
  onInput: (value: string) => void;
  uploadImage: (file: File) => Promise<string>;
  onUploadingChange: (uploading: boolean) => void;
}

export default function PostBodyEditor(props: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadInProgress = useRef(false);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const locked = props.disabled || uploading;
  const images = useMemo(() => getPostImages(props.value), [props.value]);

  function insertText(text: string, start?: number, end?: number) {
    const field = textarea.current;
    const from = start ?? field?.selectionStart ?? props.value.length;
    const to = end ?? field?.selectionEnd ?? from;
    props.onInput(`${props.value.slice(0, from)}${text}${props.value.slice(to)}`);
    setPreview(false);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(from + text.length, from + text.length);
    });
  }

  function format(before: string, after = "", placeholder = "tekst") {
    const field = textarea.current;
    const selected = props.value.slice(field?.selectionStart ?? 0, field?.selectionEnd ?? 0);
    insertText(`${before}${selected || placeholder}${after}`);
  }

  async function uploadImages(files: File[]) {
    if (!files.length || props.disabled || uploadInProgress.current) return;
    setError("");
    const invalid = files.find((file) => !acceptedTypes.has(file.type) || file.size > maxImageSize);
    if (invalid) {
      setError(!acceptedTypes.has(invalid.type)
        ? `“${invalid.name}” is geen ondersteunde afbeelding. Kies JPG, PNG, WebP of GIF.`
        : `“${invalid.name}” is te groot. Kies een afbeelding van maximaal 15 MB.`);
      return;
    }

    // Freeze the editor during uploads so insertion cannot overwrite concurrent edits.
    const start = textarea.current?.selectionStart ?? props.value.length;
    const end = textarea.current?.selectionEnd ?? start;
    const uploaded: string[] = [];
    uploadInProgress.current = true;
    setUploading(true);
    props.onUploadingChange(true);
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Afbeelding ${index + 1} van ${files.length} uploaden…`);
        const url = await props.uploadImage(file);
        const description = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
        uploaded.push(imageToMarkdown(url, description));
      }
    } catch {
      setError("Een afbeelding kon niet worden geüpload. Probeer de ontbrekende afbeeldingen opnieuw toe te voegen.");
    } finally {
      if (uploaded.length) insertText(`\n\n${uploaded.join("\n\n")}\n\n`, start, end);
      setProgress(uploaded.length ? `${uploaded.length} afbeelding${uploaded.length === 1 ? "" : "en"} toegevoegd.` : "");
      uploadInProgress.current = false;
      setUploading(false);
      props.onUploadingChange(false);
    }
  }

  return (
    <div
      class={`admin-post-composer ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
        event.preventDefault();
        if (!locked) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        setDragging(false);
        void uploadImages(Array.from(event.dataTransfer.files));
      }}
    >
      <div class="admin-post-composer-head">
        <strong>Bericht</strong>
        <div class="admin-post-editor-modes" role="group" aria-label="Weergave van het bericht">
          <button type="button" aria-pressed={!preview} disabled={uploading} onClick={() => setPreview(false)}>Schrijven</button>
          <button type="button" aria-pressed={preview} disabled={uploading} onClick={() => setPreview(true)}>Voorbeeld</button>
        </div>
      </div>
      <div class="admin-post-formatting" role="group" aria-label="Bericht opmaken">
        <button type="button" disabled={locked || preview} onClick={() => format("**", "**")}><strong>Vet</strong></button>
        <button type="button" disabled={locked || preview} onClick={() => format("*", "*")}><em>Cursief</em></button>
        <button type="button" disabled={locked || preview} onClick={() => format("\n\n- ", "\n", "Eerste punt")}>Lijst</button>
        <button type="button" disabled={locked || preview} onClick={() => format("[", "](https://)", "Linktekst")}>Link</button>
      </div>
      <div class="admin-post-writing-area">
        {preview ? (
          <div class="admin-post-preview">
            {props.value.trim()
              ? <div class="markdown post-body" dangerouslySetInnerHTML={{ __html: renderPostMarkdown(props.value) }} />
              : <p class="muted">Je tekst en afbeeldingen verschijnen hier zodra je iets toevoegt.</p>}
          </div>
        ) : (
          <label class="admin-field">
            <span class="admin-post-sr-only">Inhoud van het bericht</span>
            <textarea
              ref={textarea}
              rows={10}
              value={props.value}
              disabled={locked}
              placeholder="Schrijf je bericht… Voeg foto's toe met de knop, sleep ze hierheen of plak een afbeelding. Alleen foto's plaatsen kan ook."
              onInput={(event) => props.onInput(event.currentTarget.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData?.files ?? []);
                if (files.length) {
                  event.preventDefault();
                  void uploadImages(files);
                }
              }}
            />
          </label>
        )}
      </div>
      <section class="admin-post-media" aria-label="Foto's bij je bericht" aria-busy={uploading}>
        <div class="admin-post-media-upload">
          <span class="admin-post-media-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 5.5 9.5 3h5L16 5.5h3A2 2 0 0 1 21 7.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
              <circle cx="12" cy="12.5" r="4" />
              <path d="M17.5 8.5h.01" />
            </svg>
          </span>
          <div class="admin-post-media-copy">
            <strong>{dragging ? "Laat je foto's hier los" : "Foto's bij je bericht"}</strong>
            <p>Selecteer één of meerdere foto's, of sleep ze hierheen.</p>
          </div>
          <button class="btn admin-post-photo-button" type="button" disabled={locked} onClick={() => fileInput.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {uploading ? "Foto's uploaden…" : "Foto toevoegen"}
          </button>
          <input
            ref={fileInput}
            class="admin-post-file-input"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            aria-label="Afbeeldingen kiezen"
            disabled={locked}
            onChange={(event) => {
              const input = event.currentTarget;
              void uploadImages(Array.from(input.files ?? []));
              input.value = "";
            }}
          />
        </div>
        {images.length > 0 && (
          <div class="admin-post-media-attached">
            <p>{images.length} foto{images.length === 1 ? "" : "'s"} in je bericht</p>
            <div class="admin-post-photo-grid">
              {images.map((image, index) => (
                <figure key={`${index}-${image.url}`}>
                  <img src={image.url} alt={image.alt} loading="lazy" />
                  <figcaption>Foto {index + 1}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
        <p class="admin-post-media-hint">JPG, PNG, WebP of GIF · maximaal 15 MB per foto</p>
      </section>
      {progress && <p class="muted-small" role="status">{progress}</p>}
      {error && <p class="admin-post-upload-error" role="alert">{error}</p>}
    </div>
  );
}

import { useRef, useState } from "preact/hooks";
import { imageToMarkdown, renderPostMarkdown } from "@/lib/post-markdown";

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
    <div class="admin-post-composer">
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
        <button type="button" disabled={locked} onClick={() => fileInput.current?.click()}>＋ Afbeeldingen toevoegen</button>
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
      <div
        class={`admin-post-writing-area ${dragging ? "is-dragging" : ""}`}
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
      <p class="muted-small admin-post-composer-help">Tekst, foto's of allebei. Je kunt meerdere foto's tegelijk toevoegen en tekst tussen de foto's schrijven. JPG, PNG, WebP of GIF · maximaal 15 MB per foto.</p>
      {progress && <p class="muted-small" role="status">{progress}</p>}
      {error && <p class="admin-post-upload-error" role="alert">{error}</p>}
    </div>
  );
}

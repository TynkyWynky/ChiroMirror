import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const markdown = new Marked({
  breaks: true,
  gfm: true
});

function escapeFallback(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!).replace(/\r?\n/g, "<br>");
}

export function renderMarkdown(value: string) {
  // Also sanitize existing database content at the server rendering boundary.
  const source = typeof value === "string" ? value : String(value ?? "");
  try {
    return sanitizeHtml(markdown.parse(source, { async: false }), {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "input"],
      allowedAttributes: {
        a: ["href", "title", "name", "target", "rel"],
        img: ["src", "alt", "title", "width", "height", "loading"],
        th: ["align", "colspan", "rowspan"],
        td: ["align", "colspan", "rowspan"],
        code: ["class"],
        input: ["type", "checked", "disabled"]
      },
      allowedSchemes: ["http", "https", "mailto", "tel"],
      allowedSchemesByTag: { img: ["http", "https"] },
      transformTags: {
        a: (tagName, attributes) => ({ tagName, attribs: { ...attributes, rel: "noopener noreferrer" } }),
        input: (_tagName, attributes) => ({ tagName: "input", attribs: {
          type: "checkbox", disabled: "", ...(Object.hasOwn(attributes, "checked") ? { checked: "" } : {})
        } })
      }
    });
  } catch (error) {
    console.error("Markdown rendering failed; using escaped text fallback.", error);
    return escapeFallback(source);
  }
}

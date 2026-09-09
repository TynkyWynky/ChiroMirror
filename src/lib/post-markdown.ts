import { Marked } from "marked";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

function safeUrl(value: string, image = false) {
  // Reject entities and control characters before the browser can decode a scheme.
  if (!value || /[\u0000-\u0020\u007f<>\\]|&(?:#\w+|\w+);/.test(value)) return "";
  try {
    const url = new URL(value, "https://site.invalid");
    const protocols = image ? ["http:", "https:"] : ["http:", "https:", "mailto:", "tel:"];
    return protocols.includes(url.protocol) ? value : "";
  } catch {
    return "";
  }
}

const postMarkdown = new Marked({
  breaks: true,
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      if (!url) return label;
      return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</a>`;
    },
    image({ href, text, title }) {
      const url = safeUrl(href, true);
      if (!url) return escapeHtml(text);
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy" decoding="async" />`;
    }
  }
});

export function renderPostMarkdown(value: string) {
  return postMarkdown.parse(value ?? "", { async: false });
}

export function getPostPreview(body: string) {
  let image: { url: string; alt: string } | undefined;
  const words: string[] = [];
  const imageTextTokens = new Set<unknown>();
  postMarkdown.walkTokens(postMarkdown.lexer(body), (token) => {
    if (token.type === "image") {
      if (!image) {
        const url = safeUrl(token.href, true);
        if (url) image = { url, alt: token.text };
      }
      postMarkdown.walkTokens(token.tokens ?? [], (child) => { imageTextTokens.add(child); });
      return;
    }
    if (imageTextTokens.has(token)) return;
    if ((token.type === "text" && !("tokens" in token)) || token.type === "codespan") {
      words.push(token.text);
    }
  });
  const text = words.join(" ").replace(/\s+/g, " ").trim();
  return { image, excerpt: text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text };
}

export function imageToMarkdown(url: string, description: string) {
  const alt = description.replace(/[\r\n]+/g, " ").replace(/[\\[\]<>*_`]/g, "\\$&");
  return `![${alt}](<${url.replace(/[\s<>]/g, (value) => encodeURIComponent(value))}>)`;
}

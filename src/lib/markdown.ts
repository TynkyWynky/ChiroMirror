import { marked } from "marked";

marked.setOptions({
  breaks: true,
  gfm: true
});

export function renderMarkdown(value: string) {
  return marked.parse(value ?? "");
}

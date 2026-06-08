"use client";

import { useRef, useState } from "react";
import { Bold, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, Eye, Pencil } from "lucide-react";

// Lightweight Markdown editor: a textarea with a formatting toolbar that inserts
// Markdown around the selection, plus a live preview. Stores Markdown (the app
// renders it with its MarkdownText component) — no external editor/API key.

function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%;border-radius:8px;margin:6px 0" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const lines = md.split(/\r?\n/);
  const html: string[] = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { html.push("</ul>"); listOpen = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { closeList(); html.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`); }
    else if (/^##\s+/.test(line)) { closeList(); html.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`); }
    else if (/^#\s+/.test(line)) { closeList(); html.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`); }
    else if (/^[-*]\s+/.test(line)) { if (!listOpen) { html.push("<ul>"); listOpen = true; } html.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`); }
    else if (/^\d+\.\s+/.test(line)) { if (!listOpen) { html.push("<ul>"); listOpen = true; } html.push(`<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`); }
    else if (line === "") { closeList(); }
    else { closeList(); html.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return html.join("");
}

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");

  function surround(before: string, after = "", placeholder = "") {
    const el = ref.current;
    if (!el) { onChange(value + before + placeholder + after); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + before.length + selected.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function prefixLine(prefix: string) {
    const el = ref.current;
    if (!el) { onChange(value + "\n" + prefix); return; }
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => el.focus());
  }

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <button type="button" title="Heading 2" onClick={() => prefixLine("## ")}><Heading2 size={16} /></button>
        <button type="button" title="Heading 3" onClick={() => prefixLine("### ")}><Heading3 size={16} /></button>
        <button type="button" title="Bold" onClick={() => surround("**", "**", "bold text")}><Bold size={16} /></button>
        <button type="button" title="Italic" onClick={() => surround("*", "*", "italic")}><Italic size={16} /></button>
        <button type="button" title="Bullet list" onClick={() => prefixLine("- ")}><List size={16} /></button>
        <button type="button" title="Link" onClick={() => surround("[", "](https://)", "label")}><Link2 size={16} /></button>
        <button type="button" title="Image" onClick={() => surround("![", "](https://image-url)", "alt")}><ImageIcon size={16} /></button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" className={tab === "write" ? "md-tab active" : "md-tab"} onClick={() => setTab("write")}><Pencil size={14} /> Write</button>
          <button type="button" className={tab === "preview" ? "md-tab active" : "md-tab"} onClick={() => setTab("preview")}><Eye size={14} /> Preview</button>
        </div>
      </div>
      {tab === "write" ? (
        <textarea
          ref={ref}
          className="md-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={"## Heading\n\nWrite the article in **Markdown**.\n\n- point one\n- point two"}
        />
      ) : (
        <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value || "_Nothing to preview yet._") }} />
      )}
    </div>
  );
}

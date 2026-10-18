import type { ReactNode } from "react";

/**
 * Policy text is written as plain strings in two languages; this renders the
 * two marks it uses — **bold** and [label](href) — and nothing else, so the
 * content stays easy to edit and translate.
 */
const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

export function Rich({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) return <a key={i} href={link[2]}>{link[1]}</a>;
        return part;
      })}
    </>
  );
}

export type Block = string | { list: string[] } | { steps: string[] } | { sub: string };
export type Section = { id: string; title: string; body: Block[] };

function renderBlock(block: Block, key: number): ReactNode {
  if (typeof block === "string") return <p key={key}><Rich text={block} /></p>;
  if ("sub" in block) return <h3 key={key}>{block.sub}</h3>;
  if ("steps" in block) {
    return (
      <ol key={key}>
        {block.steps.map((s, i) => <li key={i}><Rich text={s} /></li>)}
      </ol>
    );
  }
  return (
    <ul key={key}>
      {block.list.map((s, i) => <li key={i}><Rich text={s} /></li>)}
    </ul>
  );
}

/** One card per section, each with an anchor so a section can be linked to. */
export function Sections({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="pub-card">
          <h2>{section.title}</h2>
          {section.body.map(renderBlock)}
        </section>
      ))}
    </>
  );
}

/** A contents list for the long pages. */
export function Contents({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <nav className="pub-card pub-toc" aria-label={title}>
      <h2>{title}</h2>
      <ol>
        {sections.map((s) => (
          <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
        ))}
      </ol>
    </nav>
  );
}

type Keyed = { key: string };

export type Inline = Keyed &
  (
    | { kind: "text"; text: string }
    | { kind: "code"; text: string }
    | { kind: "strong"; children: Inline[] }
    | { kind: "em"; children: Inline[] }
    | { kind: "link"; href: string; children: Inline[] }
  );

type ListItem = Keyed & { inline: Inline[] };

export type MarkdownBlock = Keyed &
  (
    | { kind: "paragraph"; inline: Inline[] }
    | { kind: "heading"; inline: Inline[] }
    | { kind: "list"; ordered: boolean; items: ListItem[] }
    | { kind: "code"; text: string }
  );

const INLINE =
  /`([^`\n]+)`|\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|\*([^*\s](?:[^*\n]*[^*\s])?)\*|\b_([^_\s](?:[^_\n]*[^_\s])?)_\b/g;

const WEB_ADDRESS = /^https?:\/\//i;

const safeHref = (href: string): string | undefined => {
  if (!WEB_ADDRESS.test(href)) return undefined;
  try {
    return new URL(href).href;
  } catch {
    return undefined;
  }
};

export function parseInline(text: string, key = ""): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  const nextKey = (): string => `${key}${parts.length}`;
  const pushText = (value: string): void => {
    if (value === "") return;
    const previous = parts.at(-1);
    if (previous?.kind === "text") previous.text += value;
    else parts.push({ kind: "text", text: value, key: nextKey() });
  };
  const nested = (inner: string): Inline[] => parseInline(inner, `${nextKey()}.`);
  for (const match of text.matchAll(INLINE)) {
    const [whole, code, strong, label, target, bare, em, underscored] = match;
    pushText(text.slice(last, match.index));
    last = match.index + whole.length;
    if (code !== undefined) parts.push({ kind: "code", text: code, key: nextKey() });
    else if (strong !== undefined) parts.push({ kind: "strong", children: nested(strong), key: nextKey() });
    else if (label !== undefined && target !== undefined) {
      const href = safeHref(target);
      if (href === undefined) pushText(whole);
      else parts.push({ kind: "link", href, children: nested(label), key: nextKey() });
    } else if (bare !== undefined) {
      const href = safeHref(bare);
      if (href === undefined) pushText(whole);
      else {
        const linkKey = nextKey();
        parts.push({ kind: "link", href, children: [{ kind: "text", text: bare, key: `${linkKey}.0` }], key: linkKey });
      }
    } else parts.push({ kind: "em", children: nested(em ?? underscored ?? ""), key: nextKey() });
  }
  pushText(text.slice(last));
  return parts;
}

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  let paragraph: string[] = [];
  const nextKey = (): string => String(blocks.length);
  const inlineOf = (text: string): Inline[] => parseInline(text, `${nextKey()}.`);
  const endParagraph = (): void => {
    if (paragraph.length > 0)
      blocks.push({ kind: "paragraph", inline: inlineOf(paragraph.join("\n")), key: nextKey() });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE.test(line)) {
      endParagraph();
      const code: string[] = [];
      for (index += 1; index < lines.length && !FENCE.test(lines[index] ?? ""); index += 1)
        code.push(lines[index] ?? "");
      blocks.push({ kind: "code", text: code.join("\n"), key: nextKey() });
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (heading !== null) {
      endParagraph();
      blocks.push({ kind: "heading", inline: inlineOf(heading[1] ?? ""), key: nextKey() });
    } else if (item !== null) {
      endParagraph();
      const ordered = numbered !== null;
      const previous = blocks.at(-1);
      if (previous?.kind === "list" && previous.ordered === ordered) {
        const itemKey = `${previous.key}.${previous.items.length}`;
        previous.items.push({ inline: parseInline(item[1] ?? "", `${itemKey}.`), key: itemKey });
      } else {
        const listKey = nextKey();
        const itemKey = `${listKey}.0`;
        blocks.push({
          kind: "list",
          ordered,
          items: [{ inline: parseInline(item[1] ?? "", `${itemKey}.`), key: itemKey }],
          key: listKey,
        });
      }
    } else if (line.trim() === "") endParagraph();
    else paragraph.push(line.trim());
  }
  endParagraph();
  return blocks;
}

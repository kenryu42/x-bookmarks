import { ArrowUpIcon, MessageCircleQuestionIcon, MinusIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type SubmitEvent,
} from "react";
import { Button } from "./ui/button.tsx";
import { parseMarkdown, type Inline, type MarkdownBlock } from "../lib/ask-markdown.ts";
import {
  askRelay,
  buildPayload,
  conversationKey,
  lastAsked,
  MAX_QUESTION_LENGTH,
  ASK_PROBLEMS,
  readConversation,
  relayIsUp,
  saveConversation,
  selectedInScope,
  truncated,
  turnId,
  type Relay,
  type Selected,
  type Turn,
} from "../lib/ask.ts";

const SELECTION_SETTLE_MS = 250;
const BAR_QUOTE_LENGTH = 90;
const PANEL_QUOTE_LENGTH = 240;

type PanelState = "closed" | "open" | "minimized";

const browserRelay: Relay = {
  fetch: (input, init) => window.fetch(input, init),
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

const sessionStore = (): Storage => window.sessionStorage;

function InlineText({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((part) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "code") {
      return (
        <code key={part.key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {part.text}
        </code>
      );
    }
    if (part.kind === "strong") {
      return (
        <strong key={part.key} className="font-semibold">
          <InlineText parts={part.children} />
        </strong>
      );
    }
    if (part.kind === "em") {
      return (
        <em key={part.key}>
          <InlineText parts={part.children} />
        </em>
      );
    }
    return (
      <a
        key={part.key}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-brand-ink underline decoration-brand/50 underline-offset-2 hover:decoration-brand"
      >
        <InlineText parts={part.children} />
      </a>
    );
  });
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.kind === "heading") {
    return (
      <p className="font-semibold">
        <InlineText parts={block.inline} />
      </p>
    );
  }
  if (block.kind === "code") {
    return <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[0.85em]">{block.text}</pre>;
  }
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List className={block.ordered ? "list-decimal pl-5" : "list-disc pl-5 marker:text-brand"}>
        {block.items.map((item) => (
          <li key={item.key}>
            <InlineText parts={item.inline} />
          </li>
        ))}
      </List>
    );
  }
  return (
    <p className="whitespace-pre-line">
      <InlineText parts={block.inline} />
    </p>
  );
}

function AskAnswer({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block) => (
        <MarkdownBlockView key={block.key} block={block} />
      ))}
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <li data-ask-turn="user" className="flex max-w-[85%] flex-col items-end gap-1 self-end">
        <blockquote className="max-w-full border-r-2 border-brand pr-2 text-right font-serif text-xs text-muted-foreground italic">
          {truncated(turn.quote, BAR_QUOTE_LENGTH)}
        </blockquote>
        <p className="rounded-2xl rounded-br-sm bg-brand-soft px-3 py-2 whitespace-pre-line">{turn.text}</p>
      </li>
    );
  }
  if (turn.role === "notice") {
    return (
      <li data-ask-turn="notice" className="text-sm text-muted-foreground italic">
        <output>{turn.text}</output>
      </li>
    );
  }
  return (
    <li
      data-ask-turn="assistant"
      className="font-[family-name:var(--issue-body,var(--font-serif))] text-[0.97rem] leading-relaxed"
    >
      <AskAnswer markdown={turn.text} />
    </li>
  );
}

function useRelayUp(endpoint: string): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    let current = true;
    void relayIsUp(endpoint, browserRelay.fetch).then((isUp) => {
      if (current) setUp(isUp);
    });
    return () => {
      current = false;
    };
  }, [endpoint]);
  return up;
}

function useSelectionInScope(
  ignoreInside: RefObject<HTMLElement | null>,
  onSelect: (selected: Selected | undefined) => void,
): void {
  const read = useEffectEvent(() => {
    const selection = document.getSelection();
    const anchor = selection?.anchorNode;
    if (anchor !== null && anchor !== undefined && ignoreInside.current?.contains(anchor)) return;
    onSelect(selectedInScope(selection));
  });
  useEffect(() => {
    let settle: number | undefined;
    const onChange = (): void => {
      window.clearTimeout(settle);
      settle = window.setTimeout(read, SELECTION_SETTLE_MS);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(settle);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);
}

const SHEET =
  "pointer-events-auto mx-auto w-full border border-border bg-card text-card-foreground shadow-xl sm:mr-0 sm:max-w-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4";

export function Ask({ endpoint }: { endpoint: string }) {
  const up = useRelayUp(endpoint);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [storageKey] = useState(() => conversationKey(window.location.pathname));
  const [turns, setTurns] = useState<Turn[]>(() => readConversation(sessionStore, storageKey));
  const [panel, setPanel] = useState<PanelState>("closed");
  const [selected, setSelected] = useState<Selected | undefined>();
  const [quoted, setQuoted] = useState<Selected | undefined>();
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);

  useSelectionInScope(root, (next) => {
    setSelected(next);
    if (panel === "open" && next !== undefined) setQuoted(next);
  });

  useEffect(() => saveConversation(sessionStore, storageKey, turns), [storageKey, turns]);

  const openPanel = (): void => {
    if (selected !== undefined) setQuoted(selected);
    setSelected(undefined);
    document.getSelection()?.removeAllRanges();
    setPanel("open");
    window.requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };

  const active = quoted ?? lastAsked(turns);

  const send = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = question.trim();
    if (text === "" || active === undefined || thinking) return;
    const payload = buildPayload({
      question: text,
      quote: active.quote,
      story: active.story,
      page: { url: window.location.href, title: document.title },
      turns,
    });
    setTurns((previous) => [
      ...previous,
      {
        id: turnId(),
        role: "user",
        text: payload.question,
        quote: active.quote,
        ...(active.story === undefined ? {} : { story: active.story }),
      },
    ]);
    setQuoted(active);
    setQuestion("");
    setThinking(true);
    const outcome = await askRelay(endpoint, payload, browserRelay);
    setThinking(false);
    setTurns((previous) => [
      ...previous,
      outcome.kind === "answer"
        ? { id: turnId(), role: "assistant", text: outcome.answer }
        : { id: turnId(), role: "notice", text: ASK_PROBLEMS[outcome.problem] },
    ]);
  };

  if (!up) return null;

  const barShown = panel !== "open" && selected !== undefined;

  return (
    <div
      ref={root}
      data-ask
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col px-safe-3 pb-safe-3 font-sans sm:px-safe-4 sm:pb-safe-4"
    >
      {barShown && (
        <section
          data-ask-bar
          aria-label="Ask about the selection"
          onPointerDown={(event) => event.preventDefault()}
          className={`${SHEET} flex items-center gap-2 rounded-2xl py-2 pr-2 pl-4`}
        >
          <p data-ask-quote className="min-w-0 flex-1 truncate font-serif text-sm text-muted-foreground italic">
            “{truncated(selected.quote, BAR_QUOTE_LENGTH)}”
          </p>
          <Button type="button" onClick={openPanel} className="h-10 rounded-full px-4">
            <MessageCircleQuestionIcon />
            Ask
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss"
            onClick={() => setSelected(undefined)}
            className="size-10 rounded-full"
          >
            <XIcon />
          </Button>
        </section>
      )}
      {panel === "minimized" && !barShown && (
        <Button
          type="button"
          data-ask-minimized
          onClick={() => setPanel("open")}
          className="pointer-events-auto ml-auto h-11 rounded-full px-4 shadow-lg"
        >
          <MessageCircleQuestionIcon />
          {thinking ? "Thinking…" : "Ask"}
        </Button>
      )}
      {panel === "open" && (
        <section
          data-ask-panel
          aria-label="Ask"
          className={`${SHEET} flex max-h-[min(36rem,75dvh)] flex-col rounded-2xl`}
        >
          <header className="flex items-center gap-1 border-b border-border py-1.5 pr-1.5 pl-4">
            <h2 className="flex-1 font-[family-name:var(--issue-heading,var(--font-heading))] text-lg font-semibold">
              Ask
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Minimize"
              onClick={() => setPanel("minimized")}
              className="size-10 rounded-full"
            >
              <MinusIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={() => {
                setPanel("closed");
                setQuoted(undefined);
              }}
              className="size-10 rounded-full"
            >
              <XIcon />
            </Button>
          </header>
          <ol
            data-ask-conversation
            aria-live="polite"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3 empty:hidden"
          >
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
            {thinking && (
              <li data-ask-thinking className="text-sm text-muted-foreground motion-safe:animate-pulse">
                <output>Thinking…</output>
              </li>
            )}
          </ol>
          <form onSubmit={(event) => void send(event)} className="flex flex-col gap-2 border-t border-border p-3">
            {active !== undefined && (
              <blockquote
                data-ask-quote
                className="border-l-2 border-brand pl-3 font-serif text-sm text-muted-foreground italic"
              >
                {truncated(active.quote, PANEL_QUOTE_LENGTH)}
              </blockquote>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={input}
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                rows={2}
                aria-label="Your question"
                placeholder={active === undefined ? "Select text on the page to ask about it" : "Ask about this…"}
                disabled={active === undefined}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                className="min-h-11 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button
                type="submit"
                aria-label="Send"
                disabled={thinking || question.trim() === "" || active === undefined}
                className="size-11 rounded-full"
              >
                <ArrowUpIcon />
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

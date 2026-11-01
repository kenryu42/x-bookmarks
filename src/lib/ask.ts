const MIN_QUOTE_LENGTH = 3;
export const MAX_QUESTION_LENGTH = 1000;
export const HEALTH_TIMEOUT_MS = 2000;
export const POLL_INTERVAL_MS = 2000;
export const ANSWER_TIMEOUT_MS = 180_000;
export const HISTORY_TURNS = 6;

const RELAY_REQUEST = { mode: "cors", credentials: "omit" } satisfies RequestInit;

export type Story = { id: string; url: string };

export type Turn = { id: string } & (
  | { role: "user"; text: string; quote: string; story?: Story }
  | { role: "assistant"; text: string }
  | { role: "notice"; text: string }
);

export const turnId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type AskPayload = {
  question: string;
  quote: string;
  page_url: string;
  page_title: string;
  story_id?: string;
  story_url?: string;
  history?: HistoryTurn[];
};

export const ASK_PROBLEMS = {
  "bad-input": "The relay could not read that question. Shorten it or pick a different passage, then try again.",
  "not-allowed": "This site is not allowed to ask the relay.",
  "rate-limited": "That is the limit of 30 questions an hour. Try again later.",
  "relay-failed": "The relay could not reach its assistant. Try again in a moment.",
  "not-configured": "The relay is not set up to answer questions yet.",
  network: "Could not reach the relay. Check your connection and try again.",
  failed: "The question could not be answered. Try again in a moment.",
  lost: "The answer was lost, please ask again.",
  timeout: "No answer after 3 minutes. The relay may still be working on it; ask again later.",
} as const;

type AskProblem = keyof typeof ASK_PROBLEMS;

export type AskOutcome = { kind: "answer"; answer: string } | { kind: "problem"; problem: AskProblem };

const ASK_STATUS_PROBLEMS: Partial<Record<number, AskProblem>> = {
  400: "bad-input",
  403: "not-allowed",
  429: "rate-limited",
  502: "relay-failed",
  503: "not-configured",
};

const ANSWER_LOST_STATUS = 404;

export type Relay = {
  fetch: typeof fetch;
  now: () => number;
  wait: (ms: number) => Promise<void>;
};

export async function relayIsUp(endpoint: string, fetchRelay: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchRelay(`${endpoint}/health`, {
      ...RELAY_REQUEST,
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

const problem = (name: AskProblem): AskOutcome => ({ kind: "problem", problem: name });

type Submitted = { kind: "submitted"; id: string } | AskOutcome;

async function submit(endpoint: string, payload: AskPayload, relay: Relay): Promise<Submitted> {
  let response: Response;
  try {
    response = await relay.fetch(`${endpoint}/ask`, {
      ...RELAY_REQUEST,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return problem("network");
  }
  if (!response.ok) return problem(ASK_STATUS_PROBLEMS[response.status] ?? "failed");
  const reply = await jsonOf(response);
  const id = isRecord(reply) ? reply["request_id"] : undefined;
  return typeof id === "string" && id !== "" ? { kind: "submitted", id } : problem("failed");
}

type Poll = { kind: "pending" } | AskOutcome;

async function poll(endpoint: string, id: string, relay: Relay): Promise<Poll> {
  let response: Response;
  try {
    response = await relay.fetch(`${endpoint}/answer?id=${encodeURIComponent(id)}`, RELAY_REQUEST);
  } catch {
    return { kind: "pending" };
  }
  if (response.status === ANSWER_LOST_STATUS) return problem("lost");
  if (!response.ok) return { kind: "pending" };
  const reply = await jsonOf(response);
  if (!isRecord(reply)) return { kind: "pending" };
  if (reply["status"] === "done" && typeof reply["answer"] === "string") {
    return { kind: "answer", answer: reply["answer"] };
  }
  return reply["status"] === "error" ? problem("failed") : { kind: "pending" };
}

export async function askRelay(endpoint: string, payload: AskPayload, relay: Relay): Promise<AskOutcome> {
  const submitted = await submit(endpoint, payload, relay);
  if (submitted.kind !== "submitted") return submitted;
  const deadline = relay.now() + ANSWER_TIMEOUT_MS;
  const answer = async (): Promise<AskOutcome> => {
    if (relay.now() >= deadline) return problem("timeout");
    await relay.wait(POLL_INTERVAL_MS);
    const reply = await poll(endpoint, submitted.id, relay);
    return reply.kind === "pending" ? answer() : reply;
  };
  return answer();
}

export function historyOf(turns: readonly Turn[]): HistoryTurn[] {
  return turns
    .flatMap((turn): HistoryTurn[] =>
      turn.role === "user" || turn.role === "assistant" ? [{ role: turn.role, text: turn.text }] : [],
    )
    .slice(-HISTORY_TURNS);
}

export function buildPayload({
  question,
  quote,
  story,
  page,
  turns,
}: {
  question: string;
  quote: string;
  story: Story | undefined;
  page: { url: string; title: string };
  turns: readonly Turn[];
}): AskPayload {
  const history = historyOf(turns);
  return {
    question: question.slice(0, MAX_QUESTION_LENGTH),
    quote,
    page_url: page.url,
    page_title: page.title,
    ...(story === undefined ? {} : { story_id: story.id, story_url: story.url }),
    ...(history.length === 0 ? {} : { history }),
  };
}

export const quoteOf = (text: string): string | undefined => {
  const quote = text.replaceAll(/\s+/g, " ").trim();
  return quote.length >= MIN_QUOTE_LENGTH ? quote : undefined;
};

const ASK_SCOPE = "[data-bookmark-id], article[data-issue], article[data-digest]";
const POST_LINK = "a[data-post-id]";

const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement);

function storyAround(start: Element, scope: Element): Story | undefined {
  const card = start.closest("[data-bookmark-id]");
  if (card instanceof HTMLElement) {
    const { bookmarkId, url } = card.dataset;
    return bookmarkId === undefined || url === undefined ? undefined : { id: bookmarkId, url };
  }
  for (let element: Element | null = start; element !== null; element = element.parentElement) {
    const links = [...element.querySelectorAll<HTMLAnchorElement>(POST_LINK)];
    const ids = new Set(links.map((link) => link.dataset["postId"]));
    if (ids.size > 1) return undefined;
    const { postId, postUrl } = links[0]?.dataset ?? {};
    if (postId !== undefined && postUrl !== undefined) return { id: postId, url: postUrl };
    if (element === scope) return undefined;
  }
  return undefined;
}

export type Selected = { quote: string; story: Story | undefined };

export function selectedInScope(selection: Selection | null): Selected | undefined {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const quote = quoteOf(selection.toString());
  const range = selection.getRangeAt(0);
  const start = elementOf(range.commonAncestorContainer);
  const scope = start?.closest(ASK_SCOPE);
  if (quote === undefined || start === null || scope === null || scope === undefined) return undefined;
  return { quote, story: storyAround(start, scope) };
}

export const conversationKey = (pathname: string): string => `grok-digest:${pathname}:ask`;

const isTurn = (value: unknown): value is Turn =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["text"] === "string" &&
  (value["role"] === "assistant" ||
    value["role"] === "notice" ||
    (value["role"] === "user" && typeof value["quote"] === "string"));

export function lastAsked(turns: readonly Turn[]): Selected | undefined {
  const last = turns.findLast((turn) => turn.role === "user");
  return last?.role === "user" ? { quote: last.quote, story: last.story } : undefined;
}

export function readConversation(storage: () => Storage, key: string): Turn[] {
  try {
    const stored: unknown = JSON.parse(storage().getItem(key) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isTurn) : [];
  } catch {
    return [];
  }
}

export function saveConversation(storage: () => Storage, key: string, turns: readonly Turn[]): void {
  try {
    storage().setItem(key, JSON.stringify(turns));
  } catch {}
}

export const truncated = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

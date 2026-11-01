import { describe, expect, it } from "vitest";
import { ASK_ENDPOINT_ENV, askEndpoint } from "../src/lib/ask-config.ts";
import { parseInline, parseMarkdown } from "../src/lib/ask-markdown.ts";
import {
  ANSWER_TIMEOUT_MS,
  ASK_PROBLEMS,
  askRelay,
  buildPayload,
  HEALTH_TIMEOUT_MS,
  HISTORY_TURNS,
  historyOf,
  lastAsked,
  MAX_QUESTION_LENGTH,
  POLL_INTERVAL_MS,
  quoteOf,
  readConversation,
  relayIsUp,
  saveConversation,
  type AskPayload,
  type Relay,
  type Turn,
} from "../src/lib/ask.ts";
import { siteConfigSchema } from "../src/lib/custom.ts";

const ENDPOINT = "https://relay.example";

type Call = { url: string; init: RequestInit | undefined };

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

function withoutKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== "key")
      .map(([name, inner]) => [name, withoutKeys(inner)]),
  );
}

const blocked = (): Storage => {
  throw new DOMException("denied", "SecurityError");
};

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value),
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeRelay(answers: (() => Response)[], ask: () => Response = () => json({ request_id: "r 1" })) {
  const calls: Call[] = [];
  let clock = 0;
  const relay: Relay = {
    fetch: (input, init) => {
      const url = urlOf(input);
      calls.push({ url, init });
      if (url.endsWith("/ask")) return Promise.resolve(ask());
      return Promise.resolve(answers.shift()?.() ?? json({ status: "pending" }));
    },
    now: () => clock,
    wait: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  };
  return { relay, calls, elapsed: () => clock };
}

const payload: AskPayload = { question: "Why?", quote: "the quote", page_url: "https://site/", page_title: "Site" };

describe("relayIsUp", () => {
  it("is true only when /health answers OK, asking without credentials", async () => {
    const calls: Call[] = [];
    const up = await relayIsUp(ENDPOINT, (input, init) => {
      calls.push({ url: urlOf(input), init });
      return Promise.resolve(new Response("ok"));
    });
    expect(up).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ENDPOINT}/health`);
    expect(calls[0]?.init).toMatchObject({ mode: "cors", credentials: "omit" });
    expect(calls[0]?.init?.headers).toBeUndefined();
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("is false when /health fails, errors or hangs past the timeout", async () => {
    expect(await relayIsUp(ENDPOINT, () => Promise.resolve(new Response("down", { status: 503 })))).toBe(false);
    expect(await relayIsUp(ENDPOINT, () => Promise.reject(new TypeError("Failed to fetch")))).toBe(false);
    const hanging = relayIsUp(
      ENDPOINT,
      (_input, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const started = Date.now();
    expect(await hanging).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(HEALTH_TIMEOUT_MS - 100);
  });
});

describe("askRelay", () => {
  it("posts the question, then polls every 2 seconds until the answer is done", async () => {
    const { relay, calls, elapsed } = fakeRelay([
      () => json({ status: "pending" }),
      () => new Response("busy", { status: 502 }),
      () => json({ status: "done", answer: "Because." }),
    ]);
    expect(await askRelay(ENDPOINT, payload, relay)).toEqual({ kind: "answer", answer: "Because." });
    const [ask, ...polls] = calls;
    expect(ask?.url).toBe(`${ENDPOINT}/ask`);
    expect(ask?.init).toMatchObject({ method: "POST", mode: "cors", credentials: "omit" });
    expect(ask?.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(bodyOf(ask?.init)).toEqual(payload);
    expect(polls.map(({ url }) => url)).toEqual(Array(3).fill(`${ENDPOINT}/answer?id=r%201`));
    expect(polls.every(({ init }) => init?.credentials === "omit" && init.mode === "cors")).toBe(true);
    expect(elapsed()).toBe(3 * POLL_INTERVAL_MS);
  });

  it("gives up honestly after 3 minutes without an answer", async () => {
    const { relay, calls, elapsed } = fakeRelay([]);
    expect(await askRelay(ENDPOINT, payload, relay)).toEqual({ kind: "problem", problem: "timeout" });
    expect(elapsed()).toBe(ANSWER_TIMEOUT_MS);
    expect(calls).toHaveLength(1 + ANSWER_TIMEOUT_MS / POLL_INTERVAL_MS);
  });

  it.each([
    [400, "bad-input", "Shorten it"],
    [403, "not-allowed", "not allowed"],
    [429, "rate-limited", "30 questions an hour"],
    [502, "relay-failed", "could not reach its assistant"],
    [503, "not-configured", "not set up"],
    [500, "failed", "could not be answered"],
  ] as const)("explains a %i from /ask without polling", async (status, problem, message) => {
    const { relay, calls } = fakeRelay([], () => json({ error: "no" }, status));
    expect(await askRelay(ENDPOINT, payload, relay)).toEqual({ kind: "problem", problem });
    expect(ASK_PROBLEMS[problem]).toContain(message);
    expect(calls).toHaveLength(1);
  });

  it("explains a network error on /ask", async () => {
    const relay: Relay = {
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
      now: () => 0,
      wait: () => Promise.resolve(),
    };
    expect(await askRelay(ENDPOINT, payload, relay)).toEqual({ kind: "problem", problem: "network" });
    expect(ASK_PROBLEMS.network).toContain("Could not reach the relay");
  });

  it("stops polling when /answer answers 404, since the relay lost the question", async () => {
    const { relay, calls } = fakeRelay([() => json({ status: "pending" }), () => json({ error: "unknown id" }, 404)]);
    expect(await askRelay(ENDPOINT, payload, relay)).toEqual({ kind: "problem", problem: "lost" });
    expect(calls).toHaveLength(3);
    expect(ASK_PROBLEMS.lost).toBe("The answer was lost, please ask again.");
  });

  it("fails when /ask returns no request id, or the answer reports an error", async () => {
    const failed = { kind: "problem", problem: "failed" };
    expect(await askRelay(ENDPOINT, payload, fakeRelay([], () => json({ id: 1 })).relay)).toEqual(failed);
    const { relay } = fakeRelay([() => json({ status: "error" })]);
    expect(await askRelay(ENDPOINT, payload, relay)).toEqual(failed);
  });
});

describe("buildPayload", () => {
  const page = { url: "https://site/magazine/2026-01-01/", title: "Issue" };

  it("sends the question, the quote, the page and the story, with no history on the first question", () => {
    expect(
      buildPayload({
        question: "What is it?",
        quote: "a quote",
        story: { id: "42", url: "https://x.com/a/status/42" },
        page,
        turns: [],
      }),
    ).toEqual({
      question: "What is it?",
      quote: "a quote",
      page_url: page.url,
      page_title: page.title,
      story_id: "42",
      story_url: "https://x.com/a/status/42",
    });
  });

  it("caps the question and sends the last turns as history, leaving notices out", () => {
    const turns: Turn[] = Array.from({ length: 5 }, (_, index): Turn[] => [
      { id: `u${index}`, role: "user", text: `q${index}`, quote: "a quote" },
      { id: `a${index}`, role: "assistant", text: `a${index}` },
      { id: `n${index}`, role: "notice", text: "timed out" },
    ]).flat();
    const sent = buildPayload({ question: "x".repeat(2000), quote: "a quote", story: undefined, page, turns });
    expect(sent.question).toHaveLength(MAX_QUESTION_LENGTH);
    expect(sent).not.toHaveProperty("story_id");
    expect(sent.history).toHaveLength(HISTORY_TURNS);
    expect(sent.history?.at(-1)).toEqual({ role: "assistant", text: "a4" });
    expect(sent.history?.at(-2)).toEqual({ role: "user", text: "q4" });
    expect(historyOf([{ id: "n", role: "notice", text: "n" }])).toEqual([]);
  });
});

describe("quoteOf", () => {
  it("collapses whitespace and needs at least 3 characters", () => {
    expect(quoteOf("  two\n\n  lines ")).toBe("two lines");
    expect(quoteOf(" ab ")).toBeUndefined();
  });
});

describe("the conversation", () => {
  it("survives in session storage and skips anything that is not a turn", () => {
    const memory = memoryStorage();
    const storage = (): Storage => memory;
    const turns: Turn[] = [
      { id: "1", role: "user", text: "q", quote: "a quote", story: { id: "1", url: "https://x.com/a/status/1" } },
      { id: "2", role: "assistant", text: "a" },
    ];
    saveConversation(storage, "k", turns);
    expect(readConversation(storage, "k")).toEqual(turns);
    expect(lastAsked(turns)).toEqual({ quote: "a quote", story: { id: "1", url: "https://x.com/a/status/1" } });
    memory.setItem(
      "k",
      JSON.stringify([{ id: "3", role: "system", text: "x" }, { id: "4", role: "user", text: "no quote" }, ...turns]),
    );
    expect(readConversation(storage, "k")).toEqual(turns);
    memory.setItem("k", "{not json");
    expect(readConversation(storage, "k")).toEqual([]);
    expect(readConversation(blocked, "k")).toEqual([]);
    expect(() => saveConversation(blocked, "k", turns)).not.toThrow();
  });
});

describe("parseMarkdown", () => {
  it("keeps raw HTML as plain text", () => {
    const blocks = parseMarkdown('<img src=x onerror="alert(1)"> and <script>alert(2)</script>');
    expect(withoutKeys(blocks)).toEqual([
      {
        kind: "paragraph",
        inline: [{ kind: "text", text: '<img src=x onerror="alert(1)"> and <script>alert(2)</script>' }],
      },
    ]);
  });

  it("links only http and https addresses", () => {
    expect(withoutKeys(parseInline("[docs](https://example.com/a?b=1) and https://example.org/x."))).toEqual([
      { kind: "link", href: "https://example.com/a?b=1", children: [{ kind: "text", text: "docs" }] },
      { kind: "text", text: " and " },
      { kind: "link", href: "https://example.org/x", children: [{ kind: "text", text: "https://example.org/x" }] },
      { kind: "text", text: "." },
    ]);
    expect(withoutKeys(parseInline("[x](javascript:alert(1)) [y](data:text/html,hi)"))).toEqual([
      { kind: "text", text: "[x](javascript:alert(1)) [y](data:text/html,hi)" },
    ]);
  });

  it("reads headings, lists, code, bold and italics", () => {
    const blocks = parseMarkdown("## Short answer\n\n- **one**\n- *two*\n\n1. `three`\n\n```\n<b>raw</b>\n```");
    expect(withoutKeys(blocks)).toEqual([
      { kind: "heading", inline: [{ kind: "text", text: "Short answer" }] },
      {
        kind: "list",
        ordered: false,
        items: [
          { inline: [{ kind: "strong", children: [{ kind: "text", text: "one" }] }] },
          { inline: [{ kind: "em", children: [{ kind: "text", text: "two" }] }] },
        ],
      },
      { kind: "list", ordered: true, items: [{ inline: [{ kind: "code", text: "three" }] }] },
      { kind: "code", text: "<b>raw</b>" },
    ]);
    const keys = JSON.stringify(blocks).match(/"key":"[^"]*"/g) ?? [];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the ask setting", () => {
  it("accepts an http or https endpoint and drops a trailing slash", () => {
    expect(siteConfigSchema.parse({ ask: { endpoint: "https://relay.example/v1/" } }).ask).toEqual({
      endpoint: "https://relay.example/v1",
    });
    expect(siteConfigSchema.parse({}).ask).toBeUndefined();
    for (const endpoint of ["ftp://relay.example", "relay.example", "https://relay.example/?k=1"]) {
      expect(siteConfigSchema.safeParse({ ask: { endpoint } }).success).toBe(false);
    }
    expect(siteConfigSchema.safeParse({ ask: { endpoint: ENDPOINT, key: "x" } }).success).toBe(false);
  });

  it("reads the endpoint from the environment before custom/config.json", async () => {
    const root = "/nonexistent-site";
    expect(await askEndpoint(root, {})).toBeUndefined();
    expect(await askEndpoint(root, { [ASK_ENDPOINT_ENV]: "" })).toBeUndefined();
    expect(await askEndpoint(root, { [ASK_ENDPOINT_ENV]: "http://localhost:8787/" })).toBe("http://localhost:8787");
    await expect(askEndpoint(root, { [ASK_ENDPOINT_ENV]: "nope" })).rejects.toThrow(`${ASK_ENDPOINT_ENV} is invalid`);
  });
});

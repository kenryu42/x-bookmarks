import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASK_ENDPOINT_ENV } from "../src/lib/ask-config.ts";
import { linkedSite, runCli } from "./linked-site.ts";

const BUILD_TIMEOUT_MS = 60_000;
const CONFIG_ENDPOINT = "https://relay.example/grok";
const ENV_ENDPOINT = "http://127.0.0.1:8787";
const ASK_CODE_MARKERS = ["/answer?id=", "Ask about the selection"];

let site = "";

const quoted = (text: string): RegExp => new RegExp(`[\`"']${text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[\`"']`);

async function build(env: Record<string, string> = {}): Promise<void> {
  const { code, output } = await runCli(site, ["build"], env);
  expect({ code, output }).toMatchObject({ code: 0 });
}

async function builtText(extension: string): Promise<string> {
  const dist = path.join(site, "dist");
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension));
  const texts = await Promise.all(files.map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")));
  return texts.join("\n");
}

async function writeConfig(config: object): Promise<void> {
  await mkdir(path.join(site, "custom"), { recursive: true });
  await writeFile(path.join(site, "custom/config.json"), JSON.stringify(config));
}

beforeEach(async () => {
  site = await linkedSite();
});

afterEach(async () => {
  await rm(site, { recursive: true, force: true });
});

describe("the Ask panel", () => {
  it(
    "ships no Ask code or markup without an endpoint",
    async () => {
      await build();
      const scripts = `${await builtText(".js")}\n${await builtText(".html")}`;
      for (const marker of ASK_CODE_MARKERS) expect(scripts).not.toContain(marker);
      expect(scripts).not.toContain("data-ask");
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "ships the panel with the endpoint from custom/config.json, which the environment overrides",
    async () => {
      await writeConfig({ ask: { endpoint: `${CONFIG_ENDPOINT}/` } });
      await build();
      const scripts = await builtText(".js");
      for (const marker of ASK_CODE_MARKERS) expect(scripts).toContain(marker);
      expect(scripts).toMatch(quoted(CONFIG_ENDPOINT));

      await build({ [ASK_ENDPOINT_ENV]: ENV_ENDPOINT });
      const overridden = await builtText(".js");
      expect(overridden).toMatch(quoted(ENV_ENDPOINT));
      expect(overridden).not.toContain(CONFIG_ENDPOINT);
    },
    2 * BUILD_TIMEOUT_MS,
  );

  it(
    "fails validate and the build on an endpoint that is not a web address",
    async () => {
      await writeConfig({ ask: { endpoint: "relay.example" } });
      const validate = await runCli(site, ["validate"]);
      expect(validate.code).toBe(1);
      expect(validate.output).toContain("ask.endpoint");
      const built = await runCli(site, ["build"]);
      expect(built.code).not.toBe(0);
      expect(built.output).toContain("ask.endpoint");
    },
    BUILD_TIMEOUT_MS,
  );
});

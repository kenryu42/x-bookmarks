import path from "node:path";
import { parseDataFile } from "./bookmarks.ts";
import { askEndpointSchema, CONFIG_FILE, CUSTOM_DIR, siteConfigSchema } from "./custom.ts";
import { fileExists, readJsonFile } from "./data-files.ts";
import { displayPath } from "./eject.ts";

export const ASK_ENDPOINT_ENV = "PUBLIC_GROK_DIGEST_ASK_ENDPOINT";

export const askConfigFile = (root: string): string => path.join(root, CUSTOM_DIR, CONFIG_FILE);

export async function askEndpoint(
  root: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const fromEnv = env[ASK_ENDPOINT_ENV];
  if (fromEnv !== undefined && fromEnv !== "") {
    return parseDataFile({ schema: askEndpointSchema, raw: fromEnv, source: ASK_ENDPOINT_ENV });
  }
  const file = askConfigFile(root);
  if (!(await fileExists(file))) return undefined;
  const source = displayPath(root, file);
  return parseDataFile({ schema: siteConfigSchema, raw: await readJsonFile({ file, source }), source }).ask?.endpoint;
}

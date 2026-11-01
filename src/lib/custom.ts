import { z } from "zod";

export const CUSTOM_DIR = "custom";
export const CONFIG_FILE = "config.json";
export const THEME_FILE = "theme.css";
export const COMPONENTS_DIR = "components";
export const EJECTED_DIR = ".ejected";
const PAGE_COMPONENTS = ["Header", "Footer", "BookmarkCard"] as const;
const REACT_COMPONENTS = [
  "ControlsLayout",
  "SearchField",
  "TopicChips",
  "FilterMenu",
  "StatusLine",
  "KeyboardHints",
  "UndoToast",
  "DoneCleanup",
  "SwipeHeader",
  "SwipeCard",
  "SwipeFooter",
  "SwipeEnd",
] as const;
export const OVERRIDABLE_COMPONENTS = [...PAGE_COMPONENTS, ...REACT_COMPONENTS] as const;

export type OverridableComponent = (typeof OVERRIDABLE_COMPONENTS)[number];

export const componentFile = (name: OverridableComponent): string =>
  `${name}${PAGE_COMPONENTS.some((page) => page === name) ? ".astro" : ".tsx"}`;

export const DEFAULT_TITLE = "Grok Digest";

const RELAY_ENDPOINT = /^https?:\/\/[^\s?#]+$/;

export const askEndpointSchema = z
  .url({ protocol: /^https?$/ })
  .regex(RELAY_ENDPOINT, "Must be an http or https address without a query or #fragment")
  .transform((endpoint) => endpoint.replace(/\/+$/, ""));

export const siteConfigSchema = z.strictObject({
  title: z.string().trim().min(1).default(DEFAULT_TITLE),
  swipeMode: z.boolean().default(true),
  ask: z.strictObject({ endpoint: askEndpointSchema }).optional(),
});

export type PageSettings = Pick<z.output<typeof siteConfigSchema>, "swipeMode">;

export function isOverridable(name: string): name is OverridableComponent {
  return OVERRIDABLE_COMPONENTS.some((component) => component === name);
}

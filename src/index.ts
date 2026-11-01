import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import type { Plugin, ViteDevServer } from "vite";
import { existsSync } from "node:fs";
import { askConfigFile, askEndpoint } from "./lib/ask-config.ts";
import { componentFile, CONFIG_FILE, CUSTOM_DIR, OVERRIDABLE_COMPONENTS, THEME_FILE } from "./lib/custom.ts";
import { BOOKMARKS_FILE, fileExists, firstFileIn, jsonFilesIn, readJsonFile, SCANS_FILE } from "./lib/data-files.ts";
import {
  conflictedOverrides,
  defaultComponentFile,
  displayPath,
  INTERNAL_PREFIX,
  MODULE_ROOT,
  overrideFile,
  staleOverrides,
} from "./lib/eject.ts";
import {
  artFileName,
  artPathsIn,
  coverFileNames,
  isArtFileName,
  isCoverFileName,
  isIssueFileName,
  MAGAZINE_DIR,
} from "./lib/magazine.ts";

export type GrokDigestOptions = {
  dataDir?: string;
};

const PACKAGE_NAME = "grok-digest";
const BOOKMARKS_MODULE_ID = "virtual:grok-digest/bookmarks";
const SCANS_MODULE_ID = "virtual:grok-digest/scans";
const CONFIG_MODULE_ID = "virtual:grok-digest/config";
const RESOLVED_CONFIG_MODULE_ID = `\0${CONFIG_MODULE_ID}`;
const MAGAZINE_MODULE_ID = "virtual:grok-digest/magazine";
const RESOLVED_MAGAZINE_MODULE_ID = `\0${MAGAZINE_MODULE_ID}`;
const THEME_MODULE_ID = "virtual:grok-digest/theme.css";
const COMPONENT_MODULE = /^virtual:grok-digest\/components\/(\w+)(\.astro)?$/;
const SCRIPT_EXTENSION = path.extname(fileURLToPath(import.meta.url));

const ROUTES = [
  { pattern: "/", entrypoint: "pages/index.astro" },
  { pattern: "/rss.xml", entrypoint: `pages/rss.xml${SCRIPT_EXTENSION}` },
  { pattern: "/rss/[topic].xml", entrypoint: `pages/rss/[topic].xml${SCRIPT_EXTENSION}` },
  { pattern: "/favicon.svg", entrypoint: `routes/favicon.svg${SCRIPT_EXTENSION}` },
  { pattern: "/robots.txt", entrypoint: `routes/robots.txt${SCRIPT_EXTENSION}` },
  { pattern: "/manifest.webmanifest", entrypoint: `routes/manifest.webmanifest${SCRIPT_EXTENSION}` },
  { pattern: "/icon-[size].png", entrypoint: `routes/icon-[size].png${SCRIPT_EXTENSION}` },
];

const MAGAZINE_ROUTES = [
  { pattern: "/magazine", entrypoint: "pages/magazine/index.astro" },
  { pattern: "/magazine/[date]", entrypoint: "pages/magazine/[date].astro" },
  { pattern: "/magazine/rss.xml", entrypoint: `pages/magazine/rss.xml${SCRIPT_EXTENSION}` },
];

const ASK_MODULE = fileURLToPath(new URL(`lib/ask-mount${SCRIPT_EXTENSION}`, import.meta.url));

const RENDERER_PACKAGES = ["@astrojs/react", "react", "react-dom"];
const PACKAGE_ENTRY = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(PACKAGE_ENTRY), "..");

const isRendererImport = (id: string): boolean =>
  RENDERER_PACKAGES.some((name) => id === name || id.startsWith(`${name}/`));

function replaceInPlace(list: string[], replacement: readonly string[]): void {
  list.splice(0, list.length, ...replacement);
}

function rendererFromPackage(): Plugin {
  return {
    name: "grok-digest:renderer",
    enforce: "pre",
    async resolveId(id, importer, options) {
      if (!isRendererImport(id)) return undefined;
      const resolveOptions = { ...options, skipSelf: true };
      const resolvesFromImporter = (await this.resolve(id, importer, resolveOptions)) !== null;
      return resolvesFromImporter ? undefined : this.resolve(id, PACKAGE_ENTRY, resolveOptions);
    },
    configResolved(config) {
      for (const { resolve } of [config, ...Object.values(config.environments)]) {
        replaceInPlace(
          resolve.dedupe,
          resolve.dedupe.filter((id) => !isRendererImport(id)),
        );
      }
    },
    configEnvironment: {
      order: "post",
      handler(_name, config) {
        const include = config.optimizeDeps?.include;
        if (include !== undefined) {
          replaceInPlace(
            include,
            include.map((id) => (isRendererImport(id) ? `${PACKAGE_NAME} > ${id}` : id)),
          );
        }
      },
    },
  };
}

function servePackageFiles(): Plugin {
  return {
    name: "grok-digest:serve-package-files",
    configResolved(config) {
      config.server.fs.allow.push(PACKAGE_ROOT);
    },
  };
}

const jsonModule = ({ source, raw }: { source: string; raw: unknown }): string =>
  `export const source = ${JSON.stringify(source)};\nexport default ${JSON.stringify(raw)};`;

function dataModule({
  moduleId,
  file,
  source,
  whenMissing,
}: {
  moduleId: string;
  file: string;
  source: string;
  whenMissing?: unknown;
}): Plugin {
  const resolvedId = `\0${moduleId}`;
  return {
    name: `grok-digest:${path.basename(file, ".json")}`,
    resolveId: (id) => (id === moduleId ? resolvedId : undefined),
    async load(id) {
      if (id !== resolvedId) return undefined;
      this.addWatchFile(file);
      if (whenMissing !== undefined && !existsSync(file)) return jsonModule({ source, raw: whenMissing });
      return jsonModule({ source, raw: await readJsonFile({ file, source }) });
    },
  };
}

const issueFilesIn = async (dir: string): Promise<string[]> =>
  (await jsonFilesIn(dir)).filter((file) => isIssueFileName(path.basename(file)));

const isMagazineFileName = (name: string): boolean =>
  isIssueFileName(name) || isCoverFileName(name) || isArtFileName(name);
const importPath = (file: string): string => JSON.stringify(file.split(path.sep).join("/"));

async function presentArt(dir: string, date: string, names: readonly string[]) {
  const pictures = [...new Set(names)].map((name) => ({ name, file: path.join(dir, artFileName(date, name)) }));
  const present = await Promise.all(pictures.map(({ file }) => fileExists(file)));
  return pictures.filter((_, index) => present[index]);
}

function magazineModule({ root, dir }: { root: string; dir: string }): Plugin {
  return {
    name: "grok-digest:magazine",
    configureServer: (server) =>
      whenFilesComeOrGo(server, { dir, named: isMagazineFileName }, () => server.watcher.emit("change", dir)),
    resolveId: (id) => (id === MAGAZINE_MODULE_ID ? RESOLVED_MAGAZINE_MODULE_ID : undefined),
    async load(id) {
      if (id !== RESOLVED_MAGAZINE_MODULE_ID) return undefined;
      const files = await issueFilesIn(dir);
      const issues = await Promise.all(
        files.map(async (file, index) => {
          this.addWatchFile(file);
          const source = displayPath(root, file);
          const raw = await readJsonFile({ file, source });
          const date = path.basename(file, ".json");
          const cover = await firstFileIn(dir, coverFileNames(date));
          const art = await presentArt(dir, date, artPathsIn(raw));
          for (const picture of art) this.addWatchFile(picture.file);
          return { index, source, raw, cover, art };
        }),
      );
      const imports = issues.flatMap(({ index, cover, art }) => [
        ...(cover === undefined ? [] : [`import cover${index} from ${importPath(cover)};`]),
        ...art.map((picture, artIndex) => `import art${index}_${artIndex} from ${importPath(picture.file)};`),
      ]);
      const entries = issues.map(({ index, source, raw, cover, art }) => {
        const artEntries = art.map(({ name }, artIndex) => `${JSON.stringify(name)}: art${index}_${artIndex}`);
        return `{ source: ${JSON.stringify(source)}, raw: ${JSON.stringify(raw)}, cover: ${cover === undefined ? "undefined" : `cover${index}`}, art: { ${artEntries.join(", ")} } }`;
      });
      return `${imports.join("\n")}\nexport default [${entries.join(",\n")}];`;
    },
  };
}

const RESTART_DELAY_MS = 200;

function whenFilesComeOrGo(
  server: ViteDevServer,
  { dir, named = () => true }: { dir: string; named?: (name: string) => boolean },
  respond: () => void,
): void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const reactToFileInDir = (file: string): void => {
    if (!file.startsWith(`${dir}${path.sep}`) || !named(path.relative(dir, file).split(path.sep).join("/"))) return;
    clearTimeout(pending);
    pending = setTimeout(respond, RESTART_DELAY_MS);
  };
  server.watcher.add(dir);
  server.watcher.on("add", reactToFileInDir);
  server.watcher.on("unlink", reactToFileInDir);
}
const IMPORT_SPECIFIER = /(\b(?:from|import)\s*\(?\s*)(["'])([^"'\s]+)\2/g;
const isBareImport = (id: string): boolean => !/^(?:[./\0]|[a-z][a-z\d+.-]*:)/i.test(id);

function customModules(root: string): Plugin {
  const customDir = path.join(root, CUSTOM_DIR);
  const configFile = path.join(customDir, CONFIG_FILE);
  const themeFile = path.join(customDir, THEME_FILE);
  const customModuleIds = `${customDir.split(path.sep).join("/")}/`;
  return {
    name: "grok-digest:custom",
    enforce: "pre",
    configureServer: (server) => whenFilesComeOrGo(server, { dir: customDir }, () => void server.restart()),
    resolveId(id) {
      if (id === CONFIG_MODULE_ID) return RESOLVED_CONFIG_MODULE_ID;
      if (id === THEME_MODULE_ID)
        return existsSync(themeFile) ? themeFile : path.join(MODULE_ROOT, "styles", THEME_FILE);
      if (id.startsWith(INTERNAL_PREFIX)) return this.resolve(path.join(MODULE_ROOT, id.slice(INTERNAL_PREFIX.length)));
      const [, base, astro] = COMPONENT_MODULE.exec(id) ?? [];
      const file = `${base}${astro ?? ".tsx"}`;
      const name = OVERRIDABLE_COMPONENTS.find((component) => componentFile(component) === file);
      if (name === undefined) return undefined;
      const override = overrideFile(root, name);
      return existsSync(override) ? override : defaultComponentFile(name);
    },
    async transform(code, id) {
      if (!id.startsWith(customModuleIds)) return undefined;
      const bare = [
        ...new Set(
          [...code.matchAll(IMPORT_SPECIFIER)]
            .map(([, , , specifier = ""]) => specifier)
            .filter(
              (specifier) =>
                isBareImport(specifier) && !specifier.startsWith(INTERNAL_PREFIX) && !isRendererImport(specifier),
            ),
        ),
      ];
      const fromPackage = await Promise.all(
        bare.map(async (specifier) =>
          (await this.resolve(specifier, id)) === null ? this.resolve(specifier, PACKAGE_ENTRY) : null,
        ),
      );
      const replacements = new Map(
        bare.flatMap((specifier, index) => {
          const resolved = fromPackage[index];
          return resolved === null || resolved === undefined ? [] : [[specifier, resolved.id] as const];
        }),
      );
      if (replacements.size === 0) return undefined;
      return code.replaceAll(IMPORT_SPECIFIER, (match, keyword: string, quote: string, specifier: string) => {
        const resolved = replacements.get(specifier);
        return resolved === undefined ? match : `${keyword}${quote}${resolved}${quote}`;
      });
    },
    async load(id) {
      if (id !== RESOLVED_CONFIG_MODULE_ID) return undefined;
      const source = displayPath(root, configFile);
      this.addWatchFile(configFile);
      if (!existsSync(configFile)) return jsonModule({ source, raw: {} });
      return jsonModule({ source, raw: await readJsonFile({ file: configFile, source }) });
    },
  };
}

export default function grokDigest({ dataDir = "data" }: GrokDigestOptions = {}): AstroIntegration {
  return {
    name: PACKAGE_NAME,
    hooks: {
      "astro:config:setup": async ({ config, updateConfig, injectRoute, injectScript, addWatchFile, logger }) => {
        const root = fileURLToPath(config.root);
        const file = path.resolve(root, dataDir, BOOKMARKS_FILE);
        const scansFile = path.resolve(root, dataDir, SCANS_FILE);
        const magazineDir = path.resolve(root, dataDir, MAGAZINE_DIR);
        updateConfig({
          integrations: [react()],
          vite: {
            plugins: [
              rendererFromPackage(),
              servePackageFiles(),
              tailwindcss(),
              dataModule({ moduleId: BOOKMARKS_MODULE_ID, file, source: displayPath(root, file) }),
              dataModule({
                moduleId: SCANS_MODULE_ID,
                file: scansFile,
                source: displayPath(root, scansFile),
                whenMissing: [],
              }),
              customModules(root),
              magazineModule({ root, dir: magazineDir }),
            ],
          },
        });
        addWatchFile(magazineDir);
        addWatchFile(askConfigFile(root));
        const endpoint = await askEndpoint(root);
        if (endpoint !== undefined) {
          injectScript(
            "page",
            `import { startAsk } from ${importPath(ASK_MODULE)};\nstartAsk(${JSON.stringify(endpoint)});`,
          );
        }
        const hasIssues = (await issueFilesIn(magazineDir)).length > 0;
        for (const { pattern, entrypoint } of [...ROUTES, ...(hasIssues ? MAGAZINE_ROUTES : [])]) {
          injectRoute({ pattern, entrypoint: new URL(entrypoint, import.meta.url) });
        }
        const conflicted = await conflictedOverrides(root);
        if (conflicted.length > 0) {
          throw new Error(`${conflicted.join(", ")} still has merge conflicts. Resolve each <<<<<<< block first.`);
        }
        for (const name of await staleOverrides(root)) {
          logger.warn(
            `${CUSTOM_DIR}/components/${componentFile(name)} was ejected from an older ${name}. Run "grok-digest merge" to bring in the new default.`,
          );
        }
      },
    },
  };
}

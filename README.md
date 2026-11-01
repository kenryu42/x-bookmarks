# grok-digest

`grok-digest` renders a Grok Digest site: X bookmarks summarized by Grok, searchable, sorted by topic, with one RSS feed per topic. A site repository holds only its `data/` files, a `package.json`, and a deploy workflow. The page, the feeds, and the schema come from this package.

[`BOT.md`](BOT.md) is the manual for the Grok bot that writes a site's data: what to do with a shared post, every field of an entry, and how to change or remove one. It ships in the package, so `node_modules/grok-digest/BOT.md` always matches the installed version.

Every deploy installs the newest `grok-digest`, so a release reaches each site the next time its Grok bot pushes a bookmark.

## Set up a site

Create a public repository and copy the [`template/`](https://github.com/kenryu42/grok-digest/tree/main/template) directory into it (skip `template/data` when the repository already has data). Enable GitHub Pages with **GitHub Actions** as the source, then:

```sh
bun install
git add bun.lock
git commit -m "Install grok-digest"
git push
```

The rest is in `template/README.md`. To convert a site that still holds a copy of the page source, follow [MIGRATION.md](https://github.com/kenryu42/grok-digest/blob/main/MIGRATION.md).

A site repository contains:

| Path                           | Contents                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data/bookmarks.json`          | The bookmarks. The Grok bot appends to it.                                                                                                                         |
| `data/processed.json`          | Optional. Ids the bot has handled.                                                                                                                                 |
| `data/removed.json`            | Optional. Ids the bot has removed.                                                                                                                                 |
| `data/scans.json`              | Optional. Posts the bot's daily scan found that the owner did not save. Strong picks show on the page.                                                             |
| `data/magazine/`               | Optional. One magazine issue per day, `YYYY-MM-DD.json`, its cover picture, `YYYY-MM-DD.jpg`, and any art it names, in `YYYY-MM-DD/`. The Grok bot makes them all. |
| `custom/`                      | Optional. The owner's changes to the page, described below.                                                                                                        |
| `package.json`                 | Depends on `"grok-digest": "latest"` and maps the scripts to the CLI below.                                                                                        |
| `bun.lock`                     | The lockfile.                                                                                                                                                      |
| `.github/workflows/deploy.yml` | Validates the data, builds with the newest `grok-digest`, and publishes to Pages.                                                                                  |

## How a site takes new versions

`deploy.yml` runs `bun install --frozen-lockfile`, then `bun update grok-digest`. The update moves `grok-digest` to the newest version that `package.json` allows, inside that run only, and commits nothing. With `"latest"`, that is the newest release.

To hold a site on one version, set the dependency to that exact version, such as `"grok-digest": "0.1.3"`. `bun update grok-digest` keeps an exact version where it is. Set it back to `"latest"` to follow releases again.

If a release fails a site's build, the deploy stops and the page that was live stays live.

## Customize a site

A site changes its page from `custom/`, and keeps every release for the parts it leaves alone. A site without `custom/` gets the page exactly as released. The owner asks the Grok bot for a change; [`BOT.md`](BOT.md) tells it how, under "Change the page".

| Path                                  | Changes                                                                                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom/config.json`                  | Settings: `title`, `swipeMode`, and `ask`. `validate` checks the file.                                                                                                                                                                  |
| `custom/theme.css`                    | Plain CSS loaded after the page's own: the color variables, fonts, and any selector.                                                                                                                                                    |
| `custom/components/<Component>.astro` | Replaces `Header`, `Footer`, or `BookmarkCard`. Tailwind classes in it work.                                                                                                                                                            |
| `custom/components/<Component>.tsx`   | Replaces a part of the controls: `ControlsLayout`, `SearchField`, `TopicChips`, `FilterMenu`, `StatusLine`, `KeyboardHints`, `UndoToast`, or `DoneCleanup`; or of swipe mode: `SwipeHeader`, `SwipeCard`, `SwipeFooter`, or `SwipeEnd`. |
| `custom/components/.ejected/`         | Written by `eject` and `merge`. The component as the site last took it from the package.                                                                                                                                                |

`grok-digest eject <Component>` copies the package's component into `custom/components/`, with its imports pointed at `grok-digest/internal/…`, the package's own modules. When a release changes that component, the build warns, and `grok-digest merge` runs `git merge-file` to apply the change to the site's copy. A change that conflicts with the site's own leaves conflict markers and makes `merge` exit with 1, and the build refuses the file until they are resolved.

The page finds cards and their parts by `data-` attributes, so an ejected `BookmarkCard` keeps them. `Header` and `Footer` carry none.

The controls island keeps its state and behavior in `useBookmarkControls` and renders `ControlsLayout`, which renders the other parts. Each part gets one prop, `controls`: the state and the functions that change it. The parts import each other through `virtual:grok-digest/components/<Component>`, which the integration resolves to the site's copy when there is one. Its fields are listed in `CUSTOMIZING.md`; renaming or removing one is a breaking change for ejected parts.

Swipe mode works the same way with `useSwipeMode` and a `swipe` prop. `SwipeMode` keeps the frame that paging and swiping depend on: the dialog, the full-height pages that scroll-snap, and the element a swipe moves. The parts render inside it. `SwipeCard` also gets `page.card`, the bookmark's server-rendered card, for anything the text blocks leave out.

## CLI

```text
grok-digest build                Build the site into dist/.
grok-digest dev                  Serve the site at http://localhost:4321 and reload on changes.
grok-digest preview              Serve the site built in dist/.
grok-digest validate [file ...]  Check the data files and custom/config.json.
grok-digest eject <component>    Copy a page component or a part of the controls into custom/components/.
grok-digest merge                Bring ejected components up to the installed version.

--data-dir <dir>  The folder that holds the data files. Defaults to "data".
--host            With dev or preview, also serve on this machine's network address.
```

`--host` lets a phone on the same Wi-Fi open the site: the command prints a `Network` address, such as `http://192.168.0.10:4321`, to open on the phone. Anyone on that network can reach it while it runs.

`build`, `dev`, and `preview` read two environment variables. `SITE_URL` is the site's origin, such as `https://<your-username>.github.io`, and becomes Astro's `site`. `BASE_PATH` is the path the site is served under, such as `/<repository-name>`, and becomes Astro's `base`, so links on a `github.io/<repository-name>/` site stay under that path. The deploy workflow sets both from GitHub Pages.

`validate` with no file checks `data/bookmarks.json`, whichever of `data/scans.json`, `data/processed.json`, `data/removed.json`, and `custom/config.json` exist, and every `.json` file in `data/magazine/`. It prints one line per file, such as `✓ data/bookmarks.json: 2 bookmarks`, and fails naming the entry and the field of an invalid file. For an issue it also prints a `⚠` warning, naming the field, for each thing that depends on the bookmarks, such as a bookmark id missing from `data/bookmarks.json` or a scan id missing from `data/scans.json`, when the issue has no cover picture, when art it names is missing, not a picture, or smaller than 1200 × 800 pixels, or shows on a post that has its own image, when a scan it shows has no source link and is not tagged `unverified`, and, for an issue with corners, when it has no Open Window item or more than 60% interest items. Warnings do not fail it, so removing or editing a bookmark never stops a deploy. A `.json` file in `data/magazine/` not named after a date gets a warning and is ignored.

The site needs no Astro config. The package depends on the Astro version it was tested with and runs it.

## Data files

`grok-digest/schema` exports `SCHEMA_VERSION`, the zod schemas, and `parseBookmarks`:

```js
import { SCHEMA_VERSION, bookmarkSchema, parseBookmarks, TOPICS } from "grok-digest/schema";
```

`SCHEMA_VERSION` is `1`. The JSON files have no version field. A `bookmarks.json` that already validates is version 1. `posted_at` with milliseconds and a `Z` offset, as the bot writes it, is version 1. The optional `media` field, a post's images, is part of version 1 too: a bookmark without it parses with `media` set to `[]`. So is a link's optional `image`, X's copy of its preview image.

| File                    | Version 1 shape                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `data/bookmarks.json`   | Array of bookmark objects. Every field is described in `BOT.md`.                                            |
| `data/processed.json`   | Array of non-empty id strings. Optional. The page does not read it.                                         |
| `data/removed.json`     | Same shape as `processed.json`. Optional. The page does not read it.                                        |
| `data/scans.json`       | Optional. Array of scan objects: a bookmark object plus an optional boolean `pick`. Described in `BOT.md`.  |
| `data/magazine/*.json`  | Optional. One magazine issue per file, named by its date. Every field is described in `BOT.md`.             |
| `data/magazine/*.jpg`   | Optional. An issue's cover picture, named by the issue's date: 3:4 portrait, as `.jpg`, `.png`, or `.webp`. |
| `data/magazine/<date>/` | Optional. The art an issue's blocks name, as `.jpg`, `.png`, or `.webp`, at least 1200 × 800.               |

Every site takes every release, so every release reads every data file an earlier release accepted. The policy is in `MIGRATION.md`.

## The page

The page title is "Grok Digest" unless `custom/config.json` sets `title`. The footer reads "Unofficial. Summaries created with Grok." Every page sends `<meta name="robots" content="noindex,nofollow">` and `<meta name="referrer" content="no-referrer">`. `robots.txt` disallows all crawlers. Feeds live at `rss.xml` and `rss/<topic-id>.xml`. Card anchors are `#b-<id>`.

The page opens on one list of the bookmarks not marked done, newest saved first. A Sort and filter menu puts the oldest saved first and shows done bookmarks. Search, topic, sort, and done are `?q=`, `?topic=`, `?sort=oldest`, and `?done=show` on the page address.

A site with `data/scans.json` also lists the scans marked `pick`, the bot's strong picks among posts the owner did not save, among the bookmarks, each with a Scan badge, and in the feeds with a `Scan` category. Done, swipe mode, search, and the removal request work on them as on bookmarks. The Sort and filter menu then adds All, Bookmarks, and Scans, `?source=bookmarks` or `?source=scans`. A site without `data/scans.json`, or with no picks in it, gets the same page as before. The behavior is documented in `template/README.md`.

### The magazine

A site with at least one issue, a `data/magazine/<YYYY-MM-DD>.json` file, also gets a magazine: `magazine/` shows the latest issue's cover large, with its title and contents, and the covers of the earlier issues by month, `magazine/<YYYY-MM-DD>/` shows one issue with links to the issues before and after it, and `magazine/rss.xml` is its feed. The header links to `magazine/`. A site without issues builds none of these, and its bookmarks page looks and works the same as without the feature.

An issue is data the Grok bot writes once a day, described in `BOT.md` under "Write a magazine issue": a title, a theme chosen from preset palettes and font pairings, and a list of blocks that show bookmarks, such as a cover story, a pull quote, or a timeline. The package draws every block, so an issue holds no HTML, CSS, or web address. Each issue has a cover picture the bot makes, `data/magazine/<YYYY-MM-DD>.jpg` (or `.png`, `.webp`). The build resizes it for each screen, and the page sets the site's title across its top. An issue without one gets a lettered cover in its palette's color, and `validate` warns. The bot can also make up to three more pictures for blocks whose post has no image, `art` on a `cover-story` or `feature`, one `image-of-the-day` block, and up to four `interlude` blocks, pictures that give a pause between corners in a `wide`, `square`, or `quiet` shape. One `painting` block can also show a famous public-domain artwork the bot downloads, uncropped, with a museum label linking its source; it does not count toward those limits. They live in `data/magazine/<YYYY-MM-DD>/`, the build resizes them the same way, and `validate` fails a path that leaves that folder. When a block names a bookmark that is gone from `data/bookmarks.json`, the page leaves out that item, or the whole block when too few items are left, and `validate` warns. A block can name a scan from `data/scans.json` instead of a bookmark; a scan without a card on the page links to its post on X. `corner` blocks open recurring sections, drawn the same in every issue, and group the "In this issue" list; a `closer` ends the issue quietly.

Each issue page has a Magazine / Digest switch at the top. Digest shows the same issue as a compact list for a quick read: each post once, in issue order, under its corner, with its "Why it matters" line (or, without one, the block's note or the post's tldr), its source, author, tags, and links to its card and to X. The page remembers the choice in the browser. `magazine/<YYYY-MM-DD>/?view=digest` and `magazine/<YYYY-MM-DD>/#digest` open the digest; `#digest` works with JavaScript off too, since both views are in the page and CSS shows the one the address targets.

### Ask (optional)

A site can let a reader select a passage and ask about it. It is off by default: a site without an endpoint ships no Ask code or markup. Turn it on with `ask` in `custom/config.json`:

```json
{ "ask": { "endpoint": "https://relay.example.com" } }
```

The `PUBLIC_GROK_DIGEST_ASK_ENDPOINT` environment variable, when set and not empty, takes the place of the setting at `build`, `dev`, and `preview`. Either one must be an `http` or `https` address without a query or `#fragment`; a trailing `/` is dropped. `validate` and the build fail on an invalid one.

The endpoint is a relay the site owner runs. The page holds no key and sends no `Authorization` header or cookies (`mode: "cors"`, `credentials: "omit"`); the relay keeps any key server-side. The relay must answer CORS requests from the site's origin, such as `https://<your-username>.github.io`, and from `http://localhost:4321` to work with `dev`, and allow the `Content-Type: application/json` header on `POST /ask`.

| Request               | Body or query            | Answer                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`         |                          | Any `2xx`. The page asks once per load and waits 2 seconds; without a `2xx` in time it shows nothing.                                                                                                                                                                                                                                               |
| `POST /ask`           | JSON, below              | `2xx` with `{ "request_id": "<id>" }`. Errors show a short message: `400` the question could not be read, `403` the site is not allowed, `429` the limit of 30 questions an hour, `502` the relay could not reach its assistant, `503` the relay is not set up. Another status, a missing `request_id`, or a network error shows a general message. |
| `GET /answer?id=<id>` | `id` is the `request_id` | `{ "status": "pending" }` until `{ "status": "done", "answer": "<markdown>" }`, or `{ "status": "error" }`. The page asks every 2 seconds for up to 3 minutes, then says it timed out. A `404` means the relay lost the question; the page stops and asks the reader to ask again. Other errors and network failures keep it polling.               |

`POST /ask` sends:

```json
{
  "question": "What does this mean for small teams?",
  "quote": "the passage the reader selected",
  "page_url": "https://example.github.io/bm/magazine/2026-02-13/",
  "page_title": "Hunger beats tenure · Grok Digest",
  "story_id": "2023456789012345678",
  "story_url": "https://x.com/someone/status/2023456789012345678",
  "history": [
    { "role": "user", "text": "Who wrote this?" },
    { "role": "assistant", "text": "It is from …" }
  ]
}
```

`question` is at most 1,000 characters. `story_id` and `story_url` are the bookmark or scan the passage belongs to, left out when the passage spans several posts. `history` is the conversation's last 6 turns, `user` or `assistant`, left out on the first question. The conversation lasts for the browser tab, per page, in `sessionStorage`.

The answer is shown as Markdown: paragraphs, headings, lists, code, bold, italics, and `http` or `https` links, which open in a new tab with `rel="noopener noreferrer"`. HTML in the answer shows as plain text.

The reader selects at least 3 characters in a bookmark card, a magazine issue, or its digest; a bar with the quote and an Ask button appears at the bottom of the screen, below the phone's own selection menu and inside its safe area. Ask opens the panel, which can be minimized to a button or closed.

## Package exports

| Export               | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grok-digest`        | Default export, the Astro integration `grokDigest({ dataDir })`, for a site that keeps its own Astro config.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `grok-digest/schema` | `SCHEMA_VERSION`, `bookmarkSchema`, `bookmarksFileSchema`, `scanSchema`, `scansFileSchema`, `stateFileSchema`, `parseBookmarks`, `parseScans`, `parseDataFile`, `TOPICS`, `TOPIC_LABELS`, and the `Bookmark`, `BookmarkFileEntry`, `Scan`, and `Topic` types. For the magazine: `magazineIssueSchema`, `magazineBlockSchema`, `parseMagazineIssue`, `MAGAZINE_BLOCK_TYPES`, `MAGAZINE_PALETTES`, `MAGAZINE_FONTS`, `MAGAZINE_EMPHASES`, `MAGAZINE_SPANS`, `MAGAZINE_CORNERS`, `MAGAZINE_TAGS`, and the `MagazineIssue` and `MagazineBlock` types. |
| `grok-digest` bin    | The CLI above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Develop

You need Bun 1.4 and Node.js 22.12 or later.

```sh
bun install
bun run dev      # builds the package, then serves template/ with dev/data at http://localhost:4321 and the printed Network address
bun run test
bun run check    # typecheck, oxlint, oxfmt, comment lint, jscpd, knip, tests, starter build
bun run format
```

`bun run dev` reads `dev/data/`, not the starter's own `template/data/`: the starter's sample bookmarks, a few scans in English, Japanese, and Chinese with two strong picks, and a few magazine issues with covers, so the magazine shows while you work on it. One issue has no cover, to show the lettered one, and the latest is laid out in corners with scans.

`bun run check` ends by packing the package with `bun pm pack`, installing the tarball into a copy of `template/` outside the repository, and building it with `SITE_URL=https://example.github.io` and `BASE_PATH=/bm-check`. It checks that the written links stay under that path. This is the same install a site's deploy does.

## Publish

Releases are cut from GitHub Actions. Open **Actions** > **Prepare Release** > **Run workflow** and choose:

| Input     | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `bump`    | `patch`, `minor`, or `major`, applied to the version in `package.json`.        |
| `version` | Optional. An exact version such as `0.2.0`, without the `v`. Overrides `bump`. |
| `dry_run` | Run every check on the new version and stop before changing Git.               |

`prepare-release.yml` refuses a version that is not newer, whose tag exists, or that is already on npm. It sets the new version, runs `bun run check`, commits `release: v<version>` to `main`, pushes the commit and the `v<version>` tag together, and starts `publish.yml` on that tag.

`publish.yml` checks the tag again, packs the tarball, publishes that exact tarball to npm with provenance, and creates a GitHub release with generated notes and the tarball attached. Rerunning it for a tag that is already on npm skips the publish and finishes the release.

npm accepts the publish through trusted publishing, so the repository holds no npm token. On npmjs.com, the package's **Settings** list `kenryu42/grok-digest` with workflow `publish.yml` as a trusted publisher.

Version 0.1.0 was published from a maintainer's machine, because npm offers trusted publishing only for a package that already exists.

## License

MIT

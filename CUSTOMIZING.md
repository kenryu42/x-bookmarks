# Customizing Grok Digest components

Reference for editing a component ejected with `bunx grok-digest eject <Component>`. The rules for when and how to change the page are in `BOT.md` under "Change the page".

The page's parts are [Astro components](https://docs.astro.build/en/basics/astro-components/), ejected as `.astro` files:

| Component      | What it is                                                              | It gets                                               |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `Header`       | The mascot, the title, and the text size, dark mode and Swipe buttons.  | `title` and `swipeMode`, from the settings, and `nav` |
| `Footer`       | The feed links and the notes at the bottom.                             | `feed`                                                |
| `BookmarkCard` | One bookmark's card. The page renders one per bookmark and strong pick. | `bookmark`, the parsed entry                          |

`bookmark` also has `source`, `"bookmark"` or `"scan"` for a strong pick from `data/scans.json`, and `onPage`, always `true` here. The package's card shows a Scan badge and "Found" in place of "Saved" for a scan, and marks its `li` with `data-source="scan"`, which swipe mode reads; keep that attribute in an ejected card so a pick keeps its badge there. An ejected card from before scans shows a pick like a bookmark.

`nav` is a link to the site's other page, `{ href, label }`, or `undefined`. On the bookmarks page it is the Magazine link, and it is `undefined` until the first magazine issue exists. On the magazine's pages it links back to the bookmarks, and `swipeMode` is `false`. An ejected `Header` without `nav` shows no such link.

`feed` is `"bookmarks"` (the default) or `"magazine"`. The bookmarks page leaves it out, so the footer links the bookmark feeds; the magazine's pages pass `"magazine"`, so it links `magazine/rss.xml`. An ejected `Footer` without `feed` links the bookmark feeds on every page.

The magazine's pages and blocks cannot be ejected. The package owns how an issue looks, and the bot changes it only through the issue's data: its theme, blocks, variants, and emphasis, described in `BOT.md` under "Write a magazine issue". `custom/theme.css` reaches them, though: an issue is an `article[data-issue]` with `data-palette` and `data-fonts`, and each block is a `section[data-block]` with `data-variant`, `data-emphasis`, and `data-span`. A corner's header is `[data-corner="<corner id>"]`, an item's tags are `[data-tag="<tag>"]`, its "Why it matters" line is `[data-why]`, and its source label is `[data-source-label]`. A post's Read the post disclosure is `details[data-post-expander]`, shown only when the post has text; its `[open]` attribute is set while the post shows. A picture the bot made for a block is `img[data-art]`, the day's closing picture is `section[data-block="image-of-the-day"]`, a pause between corners is `section[data-block="interlude"]`, with `data-variant` set to `wide`, `square`, or `quiet`, and a public-domain artwork is `section[data-block="painting"]`, with its museum label (artist, title, year, collection, source link and license) in `[data-painting-credit]`. A palette is a set of CSS variables on `[data-palette="<name>"]`: `--palette-hue` and `--palette-chroma`, from which the page works out `--brand` and the rest, and `--issue-heading` and `--issue-body` for the fonts. Setting one in `custom/theme.css`, such as `[data-palette="forest"] { --palette-hue: 160; }`, changes every issue that uses that palette.

An issue page holds both views and shows one: the magazine in `[data-view-panel="magazine"]` and the digest in `[data-view-panel="digest"]`. `html[data-issue-view]` is `magazine` or `digest` once the page's script has chosen; the switch's links are `[data-view-link="<view>"]`, with `aria-current="true"` on the one showing. The digest is an `article[data-digest]` with the issue's `data-palette` and `data-fonts`, each corner's heading is `[data-digest-corner="<corner id>"]`, each post is `li[data-digest-item]` with its line in `[data-digest-line]` (`why`, `note`, `quote`, or `try`), and the image of the day is `li[data-digest-picture]`. Interludes and paintings are not in the digest. Tags, the source label, and the "Why it matters" line use the same `[data-tag]`, `[data-source-label]`, and `[data-why]` as the magazine.

On a phone (iOS or Android), a tap on any link to a post on X, on the bookmarks page, in the magazine, or in the digest, first tries to open the post in the X app (`twitter://status?id=<id>`). If the page is still showing 1.5 seconds later, it opens the post on x.com in the same tab. Links keep their `https://x.com/<handle>/status/<id>` address, so desktops, a long press, and pages without JavaScript work as before. The page finds these links by their address, so links in an ejected component get the same behavior.

With `ask` set in `custom/config.json` (described in the package's `README.md`), every page gets the Ask panel, which cannot be ejected. `custom/theme.css` reaches it: its container is `[data-ask]`, the bar that appears over a selection is `section[data-ask-bar]`, the quoted passage is `[data-ask-quote]` in the bar and in the panel, the panel is `section[data-ask-panel]`, its conversation is `ol[data-ask-conversation]` with each turn in `li[data-ask-turn]` set to `user`, `assistant`, or `notice` (a timeout or error message), the waiting line is `[data-ask-thinking]`, and the minimized panel's button is `[data-ask-minimized]`. On an issue page it takes the issue's `data-palette` and `data-fonts`. The page finds the story a passage belongs to from `data-bookmark-id` and `data-url` on a card, and from `data-post-id` and `data-post-url` on a magazine item's links.

The controls above the cards are React components, ejected as `.tsx` files. Each gets one prop, `controls`, and must keep its named export, such as `export function FilterMenu`:

| Component        | What it is                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ControlsLayout` | Arranges the parts below, plus the Sort and filter button and the phone-only search button. Leave a part out to hide it. |
| `SearchField`    | The search box and its Cancel button.                                                                                    |
| `TopicChips`     | The topic filter chips.                                                                                                  |
| `FilterMenu`     | One row: Newest, Oldest and the Done filter. With strong picks on the page, a second row: All, Bookmarks and Scans.      |
| `StatusLine`     | The line that counts the bookmarks shown.                                                                                |
| `KeyboardHints`  | The keyboard shortcuts on desktop and the swipe tip on phones.                                                           |
| `UndoToast`      | The "Marked done" message with Undo.                                                                                     |
| `DoneCleanup`    | With Done on, Copy for Grok: a request for the Grok bot to remove the done bookmarks.                                    |

`controls` holds the page's state and what changes it. The package keeps owning the behavior: filtering, the done marks, the sort, the keyboard shortcuts, and swiping cards. A control only shows the state and calls these:

| Field                                                           | What it is                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `counts`                                                        | `toRead` and `done`: how many bookmarks are not done and done, in every topic.                                                                                      |
| `query`, `searching`, `setQuery(text)`                          | The search text, whether it is not empty, and changing it.                                                                                                          |
| `searchShown`, `openSearch()`, `closeSearch()`, `leaveSearch()` | Whether the search box shows on a phone; open it, clear and close it, or close it when empty.                                                                       |
| `topic`, `topics`, `chooseTopic(topic)`                         | The chosen topic or `null`, the topics in use, and choosing one (the chosen one again, or `null`, shows all).                                                       |
| `sort`, `chooseSort(sort)`                                      | The order: `"newest"` or `"oldest"` saved first, and choosing one.                                                                                                  |
| `showDone`, `setShowDone(on)`                                   | Whether done bookmarks show, and changing it. A search ignores it.                                                                                                  |
| `hasScans`, `source`, `chooseSource(source)`                    | Whether any strong pick from `data/scans.json` is on the page, which posts show: `"all"`, `"bookmarks"`, or `"scans"`, and choosing one.                            |
| `filtersShown`, `toggleFilters()`, `filtersChanged`             | Whether `FilterMenu` is open, opening or closing it, and whether the sort, the Done filter, or `source` differs from the default.                                   |
| `shown`, `shownDone`                                            | How many cards show, and how many of those are done.                                                                                                                |
| `undoPending`, `undo()`                                         | Whether a card was just marked done, and undoing it.                                                                                                                |
| `copyDoneRequest()`, `doneRequestCopied`                        | Copying a request for the Grok bot to remove every done bookmark, and whether it was just copied.                                                                   |
| `openSwipe()`, `settings`                                       | Opening swipe mode, and the settings from `custom/config.json`.                                                                                                     |
| `searchRef`, `topicsRef`, `barRef`                              | Put these on the search input, the chips' container, and the top bar so `/` focuses search, the chosen chip scrolls into view, and opened cards land below the bar. |

In `ControlsLayout`, import the other parts from `virtual:grok-digest/components/<Component>`, as the copy does, so that a part you eject later still shows.

Swipe mode shows one card per screen. The package keeps its frame: the full-screen dialog, the pages that snap one at a time, the swipe that opens a card's buttons, the buttons behind the card, and the keyboard keys. Eject these parts to change what is inside it. Each is a React component that gets one prop, `swipe`, and must keep its named export:

| Component     | What it is                                                                                                   | It also gets                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `SwipeHeader` | The top bar: Close, the "3 / 12" counter, the Speed read button, and the reading progress.                   |                                                |
| `SwipeCard`   | What one card shows: topic, author, headline, summary, key points, "Try:", the links, and the original post. | `page`, and `current` when it is the open card |
| `SwipeFooter` | The bottom bar: the speed reading controls, Copy, Done, Open on X, and the "Marked done" message.            |                                                |
| `SwipeEnd`    | The screen after the last card, with Start over and Close.                                                   |                                                |

`page` is one card: `id`, `author`, `topic`, `scan` (whether it is a strong pick from the daily scan), `url`, `headline`, and `blocks`, its text in order. Each block has a `kind` (`"summary"`, `"point"`, `"action"`, or `"post"`) and its `text`; speed reading reads these, so `"post"` text leaves out web addresses. `links` are the post's links that are not shown inside it, each with its `url`, `title` and, when it has one that loaded, `image`. The ejected copy shows them with `LinkCard`, as the package does. `post` is the original post in order: `{ kind: "text", text }`, `{ kind: "images", images }` with each image's `url` and `alt`, and `{ kind: "link", link }` for a link shown where its short link was. The ejected copy shows it with `PostBody`. `cover` is the post's first image as `{ url, alt }`, or `undefined` when the post has none; without one, the package shows a `TopicTile` instead. `page.card` is the bookmark's card element on the page, so `SwipeCard` can show anything else that card shows.

`swipe` holds swipe mode's state and what changes it:

| Field                                                 | What it is                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pages`, `current`, `page`, `goTo(index)`, `close()`  | Every card, the open card's index and its `page`, moving to a card (`pages.length` is the end screen), and closing swipe mode. |
| `done`, `pageDone`, `toggleDone()`                    | The ids marked done, whether the open card is, and marking it done or not done.                                                |
| `undoPending`, `undo()`                               | Whether a card was just marked done, and undoing it.                                                                           |
| `copied`, `copy()`                                    | Whether the open card was just copied, and copying it for an AI assistant.                                                     |
| `canShare`, `share()`                                 | Whether the browser can share, and opening its share sheet for the open card's post.                                           |
| `expanded`, `toggleExpanded(id)`                      | The ids whose original post is open, and opening or closing one.                                                               |
| `speedOn`, `toggleSpeed()`, `reading`                 | Whether speed reading is on, turning it on or off, and whether the open card is being speed read.                              |
| `playing`, `starting`, `finished`, `togglePlaying()`  | Speed reading's state, and playing, pausing, or reading again.                                                                 |
| `speed`, `changeSpeed(wpm)`, `plan`, `step`, `blocks` | Words per minute (200 to 600), the words to read, the word shown, and the open card's blocks.                                  |

A tap on the card outside its buttons and links opens or closes the original post, or pauses speed reading. Buttons and links in `SwipeCard` get their own clicks.

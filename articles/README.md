# Articles

Main route:

`/articles/`

The route has `noindex`. With no query string it shows the article index graph.
Individual graph-backed articles use `/articles/?article=<article-key>`.

## Shared code architecture

This page reuses the global `main.js` bootstrap for background FX.

Page-specific FX settings are passed via `#fx` data attributes in
`articles/index.html`:

- `data-wrap-selector=".essay-layout"`
- `data-active-zone-selector=".article-pane"`
- `data-mask-area-selector=".article-pane"`
- `data-word-source-selector="#article-content"`
- `data-emit-only-mini-mode="true"`

This keeps FX visible and interactive only in the article pane.
Left-mouse word mode uses words from the loaded article text.

## How to edit your current article

Article keys are folder names under `articles/`.

Example:

- key: `czech-scene-sound`
- article body: `articles/czech-scene-sound/article.html`
- article map: `articles/czech-scene-sound/map.json`
- clean route: `/articles/czech-scene-sound/`
- viewer route: `/articles/?article=czech-scene-sound`

The general `/articles/` page reads `articles/articles.json` and shows a full-page node map of every listed article.

1. Edit map nodes and connections:
`czech-scene-sound/map.json`

2. Edit article text and structure:
`czech-scene-sound/article.html`

## Required structure

Every node in `map.json` must reference a section id in `article.html`.

Example:

- map node: `"section": "field-recording-practice"`
- article section: `<section id="field-recording-practice"> ... </section>`

If IDs do not match, clicking that node will do nothing.

## Optional multi-view maps (map within map)

You can define multiple map views in one file and switch between them by
clicking nodes:

```json
{
  "defaultView": "root",
  "views": {
    "root": {
      "nodes": [
        { "id": "entities", "label": "Entities", "section": "entities", "openView": "entities" }
      ],
      "edges": []
    },
    "entities": {
      "nodes": [
        { "id": "back", "label": "Back", "section": "start", "openView": "root" }
      ],
      "edges": []
    }
  }
}
```

Notes:

- `openView` is optional on a node.
- When a node has `openView`, click switches graph view.
- If `openView` is missing, click keeps the existing section-jump behavior.
- Existing single-view maps (`nodes` + `edges` at top level) still work.

Optional node importance levels:

- Add `"importance": <number>` to a node in `map.json` (`1` is highest).
- Levels `1` and `2` are accent blue.
- Levels `3+` use black/white node colors (theme-dependent) with increasing transparency.
- Importance also changes node size (higher importance = larger node).

Compatibility:

- `"important": true` is still accepted and treated as `importance: 1`.

Only the currently selected section is shown.
Selecting a node in the map switches the visible section below.

## Adding another article later

1. Copy the template folder:
- `articles/_template/`

2. Rename the copied folder to the new key, for example:
- `articles/my-next-article/`

3. Add the article to:
`articles/articles.json`

4. Open:
`/articles/?article=my-next-article`

Optional clean URL:

- Create `articles/<article-key>/index.html` that redirects to `../?article=<article-key>`.
- Existing examples: `articles/czech-scene-sound/index.html`, `articles/perfo-map/index.html`.

## Formatting options in article HTML

Inside each section you can use:

- `<p>` for paragraph text
- `<blockquote>` for quotes
- `<ul><li>...</li></ul>` or `<ol><li>...</li></ol>` for lists
- `<a href="...">...</a>` for links

## Mention-to-Graph Hover Flags

You can mark a text fragment so hovering it highlights matching graph edge(s).

Use inline HTML with `data-graph-path`:

`<span data-graph-path="entry>field>space">mapped phrase</span>`

Notes:

- Node ids in `data-graph-path` must match node ids from `map.json` (for example `entry`, `field`).
- A chain like `a>b>c` highlights edges `a-b` and `b-c`.
- Multiple paths are supported with separators:
  - `data-graph-path="entry>field;lineage>institution"`

## Notes for local testing

The page loads content via `fetch()`, so use a local server while testing.
Opening the file directly via `file://` may fail in some browsers.

## PDF export pipeline

Use the script below to generate a print-styled PDF that keeps the graph at
the top, expands all sections, and hides the sound toggle:

```powershell
powershell -ExecutionPolicy Bypass -File .\articles\export-article-pdf.ps1 -Article czech-scene-sound
```

Output defaults to:

`articles/output/czech-scene-sound.pdf`

Optional parameters:

- `-OutputPath articles/output/custom-name.pdf`
- `-Port 4173`
- `-LoadBudgetMs 12000`

Print rendering mode is also available directly in browser via:

`/articles/?article=czech-scene-sound&print=1`

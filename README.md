# jarjar

Self-hosted, open-source behavior analytics in the spirit of Hotjar: **session recordings**, **heatmaps**, an on-page **feedback widget** and **surveys**, in one small Node.js service backed by SQLite.

- **Session recordings** — watch real visits (powered by [rrweb](https://github.com/rrweb-io/rrweb)), with a timeline of page views, clicks, rage clicks, JavaScript errors, custom events and feedback. Skip inactivity, change speed, jump to any moment.
- **Heatmaps** — click, mouse-move and scroll-depth maps per page and device (desktop / tablet / mobile), drawn on top of a real snapshot of the page. Clicks are stored relative to the element that was clicked, so they line up even when the page renders at a different width. See your most clicked elements and highlight them on the page.
- **Feedback widget** — a "rate your experience" tab (emoji or stars, plus a comment). Visitors can point at the part of the page they mean; you see it outlined on the page and can jump to that moment in their recording. Position, color, every piece of wording (any language) and the pages and devices it appears on are configurable.
- **Surveys** — NPS (0–10), single choice, multiple choice and written questions, shown one at a time in a corner card. Target pages and devices; show them right away, after a delay, after scrolling, or when the visitor is about to leave. Results include the NPS score, answer charts and every response linked to its recording. Start from templates and preview any survey on the Test page.
- **Insights** — a ranked list of what to fix, found across all visits: rage-click and dead-click hotspots, recurring JavaScript errors, forms people start but don't send (and the field where they stop), content most visitors never scroll to, pages people bounce from or leave on, badly rated pages and the leakiest funnel steps. Each comes with a plain-language fix and links to example recordings and the heatmap.
- **Journeys and funnels** — a path explorer (where visitors go from each page, and where they leave), the most common paths, and funnels made of page and event steps with conversion per step and recordings of the people who dropped off.
- **Overview** — sessions, visitors, page views, session length, top issues, top pages with average scroll depth, referrers, devices, browsers and OS, with comparisons to the previous period.
- **Frustration signals** — rage clicks (3+ rapid clicks in one spot), dead clicks (nothing on the page reacts within a second) and uncaught JS errors are detected automatically and filterable.
- **Privacy by default** — form inputs are always masked, text masking and element blocking are opt-in per element or site-wide, Do Not Track / Global Privacy Control are respected, headless browsers and bots are ignored, and data is deleted after a configurable retention period.

## Quick start

Requires **Node.js 22.13+** (jarjar uses the built-in `node:sqlite`, so there are no native dependencies).

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

Open http://localhost:3000, create the owner account, add a site, and paste the snippet it gives you into the `<head>` of your pages:

```html
<script async src="https://your-jarjar-host/t.js" data-site="SITE_KEY"></script>
```

Don't have a site handy, or don't want to touch it yet? Open **Test page** in the dashboard. It embeds a demo shop with the tracker installed and shows live what jarjar captures as you use it (recording, clicks, rage clicks, errors, scroll depth, events, feedback, heatmap snapshot), with links to the results and a button to delete the test data.

### Development

```bash
npm run dev          # API on :3000 (auto-restart), tracker rebuild on change, dashboard with HMR on :5173
npm test             # server tests (node:test)
npm run typecheck
```

Open http://localhost:5173 during development; Vite proxies the API and tracker to port 3000.

## Deploying

For a production server with automatic HTTPS, follow [deploy/README.md](deploy/README.md). It covers AWS Lightsail step by step; the [`deploy/`](deploy) folder works on any Linux server with Docker.

For a quick local container:

```bash
docker compose up -d
```

Data is kept in the `jarjar-data` volume. Behind a reverse proxy serving HTTPS, set `JARJAR_TRUST_PROXY=true` and `JARJAR_SECURE_COOKIES=true`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to bind |
| `JARJAR_DATA_DIR` | `./data` | Where the SQLite database lives |
| `JARJAR_RETENTION_DAYS` | `30` | Recordings and heatmap data older than this are deleted (checked hourly) |
| `JARJAR_TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers (needed for correct client IPs behind a proxy) |
| `JARJAR_SECURE_COOKIES` | `false` | Mark the dashboard session cookie `Secure` (use with HTTPS) |
| `LOG_LEVEL` | `info` | Server log level |

Per-site settings (allowed domains, sampling rate, text masking, Do Not Track, feedback widget) are managed in the dashboard under **Settings**.

Country breakdowns are read from proxy headers when present (`CF-IPCountry`, `X-Vercel-IP-Country`, `CloudFront-Viewer-Country`, `X-Country-Code`); jarjar does no IP geolocation itself and never stores IP addresses.

## Tracking API

```js
// Optional: queue calls made before t.js has loaded
window.jarjar = window.jarjar || function () { (jarjar.q = jarjar.q || []).push(arguments); };

jarjar('identify', 'user-42', { plan: 'pro' }); // attach your user id and attributes to the session
jarjar('event', 'checkout_started');             // tag the recording; filter recordings by it later
jarjar('optOut');                                // stop tracking this browser (stored in localStorage)
jarjar('optIn');
```

Privacy markup:

- `data-jj-mask` (or class `jj-mask`) — replace an element's text with asterisks in recordings.
- `data-jj-block` (or class `jj-block`) — don't record the element at all (shown as an empty box).
- Inputs, textareas and selects are always masked.

## How it works

```
 your site                         jarjar server                          dashboard
┌──────────────────┐  POST /i/collect  ┌──────────────────────────┐  /api/*  ┌────────────────────┐
│ t.js             │ ───────────────▶  │ Fastify                  │ ◀──────▶ │ React SPA          │
│  rrweb recorder  │  (gzip, batched   │  validate, upsert session│          │  rrweb-player      │
│  clicks / moves  │   every 5 s)      │  and page view, store    │          │  heatmap renderer  │
│  scroll depth    │                   │  points + rrweb chunks   │          │  over rebuilt page │
│  feedback widget │  POST /i/feedback │ SQLite (WAL, node:sqlite)│          │                    │
└──────────────────┘                   └──────────────────────────┘          └────────────────────┘
```

- **Tracker** (`src/tracker`, ~29 KB gzipped). It records DOM changes with rrweb and keeps one session per tab, which ends after 30 minutes of inactivity. Clicks and mouse moves are stored as CSS selector + relative offset, scroll depth per page view. Route changes in single-page apps count as new page views and trigger a fresh snapshot. Batches are gzipped with `CompressionStream` and sent as `text/plain` so they need no CORS preflight; the last batch goes out with `sendBeacon` when the page is hidden.
- **Server** (`src/server`). Ingestion validates and caps every batch, stores rrweb events as gzipped chunks and keeps the newest full snapshot of every page/device pair as the heatmap backdrop. The dashboard API serves sessions, events, heatmap points and aggregates. Auth uses scrypt-hashed passwords and HttpOnly session cookies, with a same-origin check on writes.
- **Dashboard** (`src/dashboard`). Heatmaps rebuild the stored snapshot in a sandboxed iframe with rrweb's replayer, resolve each selector to the element's current box, and render the heat on a canvas. Because canvases don't paint in script-less sandboxes, the result is inserted into the frame as an image.

```
src/
  shared/protocol.ts   wire format shared by tracker and server
  tracker/             browser script (t.js)
  server/              Fastify app, SQLite schema, ingestion, API routes, retention job
  dashboard/           React + Vite single-page app
public/demo.html       demo page with the tracker installed
test/                  server tests
```

## Limitations and ideas

- One workspace: every account sees every site. Only the first account can be created from the UI.
- SQLite suits a single instance and modest traffic. For heavy traffic, lower the sampling rate per site; a Postgres/ClickHouse backend would be the next step.
- Heatmaps are drawn on the most recent snapshot of a page, so content that only appears after interaction (menus, modals) isn't in the backdrop.
- Readable labels for clicked elements come from their visible text (never from what visitors type), and are skipped when "mask all text" is on or for masked elements.
- Not yet built: email notifications, inviting team members, and sharing recordings by link.

## License

MIT

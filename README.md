# Trustpilot Outreach Automation

![Pipeline Demo](demo.gif)

Turn Trustpilot complaints into personalized cold emails — automatically. This tool scrapes 1–2 star reviews for each lead, uses Gemini AI to identify operational pain points, and generates three A/B-tested email variants per lead. Drafts land directly in Gmail, optionally scheduled for delivery within configurable business hours.

**Who it's for:** Sales and outreach teams targeting companies with visible customer complaints on Trustpilot.

---

## Architecture

```
Leads CSV / Manual Entry
         │
         ▼
  Google Sheet (Sheet1)
  ─────────────────────
  Status | Name | Company | Email | Website
         │
         ▼
  Trustpilot Scraper (Puppeteer)
  ─ searches by website domain
  ─ scrapes 1–2 star reviews
         │
         ▼
  Gemini AI (gemini-2.5-flash)
  ─ identifies operational pain points
  ─ selects most compelling quote
         │
         ▼
  Email Generator (3 A/B Variants)
  ┌──────────────────────────────────┐
  │ A: Direct Value                  │
  │ B: Curiosity Gap                 │
  │ C: Peer Comparison               │
  └──────────────────────────────────┘
         │
         ▼
  Google Sheet (Emails tab)   ──►   Gmail Drafts
         │
         ▼
  Scheduled Send
  ─ business hours only
  ─ 15–25 min randomized intervals
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Frontend | Vanilla JS SPA (dark theme, shadcn palette) |
| Scraping | Puppeteer (headless Chromium) |
| AI | Google Gemini (`gemini-2.5-flash`) |
| Spreadsheet | Google Sheets API v4 (service account auth) |
| Email | Gmail API (OAuth2 user auth) |
| File upload | multer |

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd trustpilot-outreach-automation
npm install
```

### 2. Get a Gemini API key

Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and create a key. You can enter it in the web UI later — no need to add it to `.env` manually.

### 3. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Google Sheets API** and **Gmail API**
3. Create a **Service Account** for Sheets access:
   - Go to IAM & Admin → Service Accounts → Create
   - Download the JSON key and save as `credentials.json` in the project root
   - Share your Google Sheet with the service account email (`...@...iam.gserviceaccount.com`)
4. Create an **OAuth 2.0 Client ID** for Gmail access:
   - Go to Credentials → Create Credentials → OAuth 2.0 Client ID
   - Application type: **Desktop app**
   - Download the JSON and save as `gmail-credentials.json` in the project root

### 4. Configure environment variables (optional)

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_SHEET_ID=your_google_sheet_id_here
GOOGLE_CREDENTIALS_PATH=./credentials.json
```

> These can also be configured via the web UI — settings are persisted to `settings.json` and take precedence over `.env`.

### 5. Start the server

```bash
npm run web
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Complete setup in the UI

1. Go to the **Setup** tab
2. Enter your Gemini API key and click **Test**
3. Paste your Google Sheet URL and click **Connect** (auto-formats the sheet on first connect)
4. Click **Connect Gmail** — a browser window opens for OAuth authorization
5. Select your send-from email or alias

---

## Usage

### Setup Tab

| Section | What it does |
|---|---|
| Gemini API Key | Enter and live-test your API key |
| Google Sheet | Paste Sheet URL or ID; auto-formats headers and column widths on connect |
| Google Service Account | Displays the service account email to use when sharing your Sheet |
| Gmail | OAuth2 connection; shows connected email; supports multiple send-as aliases |
| CSV Import | Drag-and-drop or click to upload; choose Append (deduplicate by email) or Replace (clears existing leads first) |
| Manual Entry | Add individual leads via form |

### Processing Tab

1. The leads table loads from Sheet1 automatically. Use the filter bar (**All / Unprocessed / Successful / Skipped / Failed**) or the search box to find leads.
2. Select leads using the toggle controls: **Unprocessed**, **Page**, or **All** (click again to deselect).
3. Click **Process Selected** to start. The Activity Log shows real-time events.
4. After processing, each row shows a Gmail draft link and (if scheduled) the scheduled send time.

**Status values:**

| Status | Meaning |
|---|---|
| Queued | Waiting to be processed |
| Processing | Currently running |
| Successful | Reviews scraped, emails generated, draft created |
| Skipped - No Trustpilot | No Trustpilot profile found for this company |
| Skipped - No Reviews | Profile found but no 1–2 star reviews |
| Failed | Error during scraping or generation |

---

## Google Sheet Structure

### Sheet1 — Leads input

| Column | Description |
|---|---|
| A — Status | Processing status (written by the tool) |
| B — First Name | Lead's first name |
| C — Last Name | Lead's last name |
| D — Company | Company name |
| E — Email | Lead's email address |
| F — Website | Company website (used to find Trustpilot profile) |

> The sheet is auto-formatted on first connection: frozen header row, column widths, dark header style, alternating row colors, and borders.

### Emails tab — Output

| Column | Description |
|---|---|
| Company | Company name |
| CEO Name | First name used in email salutation |
| CEO Email | Destination email address |
| Trustpilot URL | Scraped profile URL |
| Pain Points | Operational issues identified by Gemini |
| Email Draft (A/B/C) | Three generated variants |
| Status | Draft / Scheduled / Sent |
| Scheduled Time | Formatted send time (if scheduled) |

---

## Email Generation — A/B Variants

All three variants are generated in parallel using `gemini-2.5-flash`. Each targets a different conversion psychology.

### Variant A — Direct Value

**Strategy:** Lead with the observed pattern, offer something specific and tangible.

**Structure:** Pattern observation → Specific insight → Direct value offer

**Example tone:**
> 12 delivery complaints in 60 days. Concentrated in Nov–Dec.
>
> **_"Ordered Nov 20, promised Nov 25. Nothing by Dec 4."_**
>
> Peak season fulfillment. I've seen 3 specific fixes that cut this 70%.
>
> Want the breakdown?

---

### Variant B — Curiosity Gap

**Strategy:** Create intrigue with a data-driven question; invite exploration.

**Structure:** Intriguing question → Data point → Pattern insight → Follow-up question

**Example tone:**
> What changed between October (4.2★) and December (1.8★)?
>
> **_"Ordered Nov 20, promised Nov 25. Nothing by Dec 4."_**
>
> 18 complaints mention Black Friday week specifically.
>
> Seeing the same pattern on your end?

---

### Variant C — Peer Comparison

**Strategy:** Non-judgmental peer observation; collaborative, not consultative.

**Structure:** Observation → Relatable shared experience → Collaborative question

**Example tone:**
> Noticed 18 delivery issues cluster around holiday weeks.
>
> **_"Ordered Nov 20, promised Nov 25. Nothing by Dec 4."_**
>
> Same thing hit us during peak season — took 3 tries to get it right.
>
> What's your current approach during spikes?

---

### Email format rules (all variants)

- Subject: 2–3 lowercase words (e.g., `delivery pattern`, `peak season`)
- Body: 50–85 words
- Sentences: 10–15 words max
- One review quote wrapped in `<b><i>"..."</i></b>`
- CTA question on its own line with a blank line before it
- No em dashes, no salesy language, peer-to-peer tone
- Includes user's Gmail signature

---

## Scheduled Sending

After drafts are created, the scheduler queues emails for delivery:

- Configurable business hours (start time, end time, timezone)
- Randomized 15–25 minute intervals between sends to appear natural
- On server restart, emails with `Scheduled` status in the Emails tab are recovered automatically — future times re-queue normally; past times within 7 days roll forward to the same clock time; times older than 7 days are marked `Expired`

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/settings` | Return current config (API key masked) |
| POST | `/api/settings` | Save Gemini key and/or Sheet ID |
| POST | `/api/settings/test-gemini` | Validate Gemini API key |
| POST | `/api/settings/test-sheet` | Validate Sheet connection and trigger auto-format |
| POST | `/api/settings/gmail-auth` | Trigger Gmail OAuth flow |
| POST | `/api/settings/gmail-disconnect` | Remove Gmail token |
| GET | `/api/settings/gmail-send-as` | List available send-as addresses |
| POST | `/api/settings/send-from` | Save preferred send-from email |
| GET | `/api/leads` | Fetch all leads from Sheet1 |
| POST | `/api/import-leads` | CSV import (multipart/form-data, append or replace mode) |
| POST | `/api/process` | Start processing selected leads |
| POST | `/api/stop` | Stop the active processing job |
| GET | `/api/status` | Poll current job progress and per-lead status |

---

## File Descriptions

```
trustpilot-outreach-automation/
├── public/
│   └── index.html              # Single-page web UI (dark theme, vanilla JS)
├── src/
│   ├── server.js               # Express server, all API endpoints, job state management
│   ├── sheets.js               # Google Sheets read/write via service account
│   ├── trustpilot.js           # Puppeteer scraper — finds profile, scrapes 1–2★ reviews
│   ├── emailGen.js             # Gemini AI email generation — 3 A/B variants in parallel
│   ├── gmail.js                # Gmail OAuth2 client, draft creation, send-as aliases
│   ├── draftEmails.js          # CLI script to create Gmail drafts from Emails tab
│   ├── regenerate-emails.js    # CLI script to re-run email generation for a specific row
│   ├── format-sheet.js         # CLI script to manually apply Sheet1 formatting
│   └── index.js                # CLI entry point (batch processing without web UI)
├── directives/
│   └── trustpilot_outreach.md  # SOP documentation for the pipeline
├── .env.example                # Environment variable template
├── demo.gif                    # Pipeline demo animation
└── package.json
```

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm run web` | Start the web UI server at http://localhost:3000 |
| `npm start` | CLI batch processor (no web UI) |
| `npm run format` | Re-apply Sheet1 formatting |
| `npm run regenerate` | Regenerate emails for a specific row |
| `npm run draft-emails` | Create Gmail drafts from the Emails tab |

---

## Secrets — Gitignored Files

These files contain credentials and are excluded from version control:

```
.env
credentials.json
gmail-credentials.json
gmail-token.json
settings.json
```

---

## Troubleshooting

### "Skipped - No Trustpilot" for many leads

The scraper searches by company website domain. If the domain doesn't match the Trustpilot profile, the profile may not be found. This is expected behavior, not a failure.

### Timeout errors / "Failed" status

Trustpilot pages can be slow. If you see multiple failures:

- Process in smaller batches (5–10 leads at a time)
- Wait 60–90 seconds between batches
- Avoid peak traffic hours

### Gmail OAuth won't complete

Confirm `gmail-credentials.json` is in the project root and the OAuth client type is **Desktop app** (not Web). The flow opens a browser window — allow it through your firewall if needed.

### Gemini API key invalid

Verify the key at [aistudio.google.com](https://aistudio.google.com) and confirm `gemini-2.5-flash` is available in your region.

### Sheet connection fails

Confirm the service account email shown in the Setup tab has been added as an **Editor** on your Google Sheet.

### Scheduled emails not recovered after restart

The server reads `Scheduled` status from the Emails tab on startup. If a scheduled time is more than 7 days in the past, it is marked `Expired` and will not send.

### Rate limiting from Trustpilot (429 errors)

Reduce batch size to 3–5 leads and increase the delay between batches. Processing during off-peak hours reduces the likelihood of blocks.

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.22.1 | HTTP server and API routing |
| `puppeteer` | ^23.6.0 | Headless browser for Trustpilot scraping |
| `@google/generative-ai` | ^0.21.0 | Gemini AI client for email generation |
| `googleapis` | ^144.0.0 | Google Sheets and Gmail API clients |
| `multer` | ^2.1.1 | Multipart form handling for CSV uploads |
| `dotenv` | ^16.4.5 | Environment variable loading |

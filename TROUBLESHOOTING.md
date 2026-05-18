# Troubleshooting

For the common cases (Skipped, OAuth, Sheet, Gemini key) see the FAQ and Troubleshooting accordion in the [README](README.md). This file covers deeper failures and operational tactics.

---

## Reading the result counters

After a run you'll see something like `Success: 12, Skipped: 9, Failed: 2`. These mean different things:

- **Success** — Trustpilot page found, recent negative reviews exist, Gemini generated drafts, Gmail drafts created.
- **Skipped** — Either no Trustpilot page matched the company website, or there were no 1–2★ reviews in the last 6 months. Expected behavior, not a bug. Roughly 30–60% of any cold list will skip.
- **Failed** — A real error occurred. Scrape timeout, Gemini API error, Gmail OAuth expired, or a network issue. Worth investigating.

A run that comes back 0 success / mostly skipped does not mean the tool broke. It means the leads on that list don't have negative reviews on Trustpilot. Try a list of companies you already know have public complaints.

---

## Persistent timeouts

Trustpilot pages can be slow during peak hours and the scraper waits for the review feed to render before extracting. Built-in timeouts:

- Page load: 30s
- Review scrape: 60s
- Review selector wait: 15s

If you're seeing repeated `Failed` rows with timeout errors:

1. Reduce batch size to 5 leads at a time.
2. Wait 60–90 seconds between batches.
3. Avoid US/EU business hours — run early morning or weekends.
4. Check your network. The scraper uses a real headless Chromium and is sensitive to flaky DNS.

---

## Rate limiting (429 from Trustpilot)

Trustpilot rate-limits aggressive requestors. If you start seeing 429s or a sudden cluster of failures:

1. Stop processing immediately. Continuing makes it worse.
2. Wait 30+ minutes before resuming.
3. Drop batch size to 3 leads and add manual pauses between batches.
4. Consider whether your volume target makes sense for this tool. A few hundred companies a week is well within normal scraper hygiene. Ten thousand a day is not.

If you're getting rate-limited from Gemini (`429 Resource Exhausted`), you've hit the free tier quota. Either wait for the daily reset or move to a paid Gemini key.

---

## Recovering a partial run

If a batch dies halfway through:

1. Open the Google Sheet. The `Status` column in Sheet1 tracks per-row state. Anything still showing `New` or `Failed` needs to be re-run.
2. From the web UI, filter the Leads table by `Failed` or `New`, select the rows, and click Run again. The pipeline is idempotent — it won't double-draft anything already in `Drafted` or `Sent` state.
3. Failed rows do not block other rows. You can keep processing forward while you decide whether to retry the failed ones.

---

## Scheduled emails missing after a server restart

On startup the server reads the `Scheduled` status from the Emails tab and rebuilds its queue:

- Future send times re-queue normally.
- Past times within 7 days roll forward to the same clock time on the next eligible business day.
- Times older than 7 days are marked `Expired` and dropped from the queue.

If you restart the server during business hours, expect a brief gap as the queue rebuilds. Check the Activity Log to confirm the queue restored.

---

## Gmail-side issues

**OAuth token revoked.** Google revokes OAuth tokens after long idle periods, password changes, or 2SV resets. Symptom: every send fails with an auth error. Fix: Setup tab → Gmail Account → Disconnect → reconnect.

**Send-as alias not working.** The Gmail API can only send from addresses that are verified as send-as aliases on the connected account. If your alias dropdown is empty, add the alias in Gmail Settings → Accounts → "Send mail as" first, verify it, then refresh the Setup tab.

**Drafts created but not visible in Gmail.** Gmail caches the drafts folder aggressively. Refresh the Gmail web tab, or search for the recipient address — the draft will be there.

---

## Headless Chromium / Puppeteer issues

**`Chromium failed to download`.** Run `npx puppeteer browsers install chrome` from the project root, then restart.

**`Protocol error (Target.setAutoAttach)`.** Usually a version mismatch after a partial `npm install`. Delete `node_modules` and `package-lock.json`, then `npm install` again.

**Running on a VPS / Linux server without a desktop.** Install the system Chromium dependencies first:

```bash
sudo apt-get install -y \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2
```

The default `puppeteer-extra-plugin-stealth` config is tuned for desktop runs. On a server, expect a slightly higher skip rate and consider running with `--no-sandbox` only if you understand the implications.

---

## Debug output

For verbose logs during a run:

```bash
NODE_DEBUG=* npm run web
```

Or capture a single CLI run:

```bash
node src/index.js --start=ROW_NUMBER --limit=1 2>&1 | tee processing.log
```

Most useful errors appear in the server console (web mode) or stdout (CLI mode), not in the UI. If you're filing an issue, attach a few lines of log around the failure.

---

## Pre-flight checklist

Before kicking off a real batch:

- `.env` and `credentials.json` exist in the project root
- Service account email is added as Editor on your Google Sheet
- Gmail OAuth shows Connected in the Setup tab
- Outreach Profile is filled in (the default templates work but generic profiles produce generic drafts)
- Delivery mode is `Create drafts only` for the first run — verify the output looks right before turning on scheduled send
- Batch size set conservatively (5–10 leads on your first real run)

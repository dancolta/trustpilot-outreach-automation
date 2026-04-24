# Trustpilot Outreach Automation

![Pipeline Demo](demo.gif)

Automated lead generation system that scrapes negative Trustpilot reviews, identifies technical pain points, and generates high-converting cold outreach emails.

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Google Sheet   │────▶│   Trustpilot    │────▶│   Gemini AI     │
│  (Lead Data)    │     │   (Scraping)    │     │  (Email Gen)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │              ┌─────────────────┐              │
        └─────────────▶│  Emails Tab     │◀─────────────┘
                       │  (Output)       │
                       └─────────────────┘
```

1. **Read leads** from Google Sheet (company name, CEO, website)
2. **Find Trustpilot page** for each company
3. **Scrape 1-2 star reviews** using Puppeteer
4. **Analyze pain points** with Gemini AI (frames as technical failures)
5. **Generate cold email** using high-converting formula
6. **Write results** to Emails tab + mark source row as processed

## Project Structure

```
Outreach Automation/
├── package.json              # Dependencies & scripts
├── .env                      # API keys & Sheet ID
├── credentials.json          # Google service account (gitignored)
├── .gitignore
├── README.md
├── public/
│   └── index.html            # Web interface (frontend)
├── directives/
│   └── trustpilot_outreach.md   # SOP documentation
└── src/
    ├── server.js             # Express server (web interface backend)
    ├── index.js              # Main orchestrator (CLI)
    ├── sheets.js             # Google Sheets read/write
    ├── trustpilot.js         # Trustpilot scraper
    ├── emailGen.js           # Gemini email generation
    ├── format-sheet.js       # Apply table formatting
    └── regenerate-emails.js  # Regenerate existing emails
```

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Google Cloud Setup
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project
3. Enable **Google Sheets API**
4. Create a Service Account (IAM & Admin → Service Accounts)
5. Download JSON key → save as `credentials.json` in project root
6. Share your Google Sheet with the service account email (Editor access)

### 3. Gemini API Key
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create API key
3. Add to `.env`

### 4. Configure .env
```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_CREDENTIALS_PATH=./credentials.json
```

## Quick Start (Web Interface)

The easiest way to use this app - a modern web UI.

### Step 1: Install Dependencies (first time only)
```bash
cd ~/Work/nodesparks/Projects/Outreach\ Automation
npm install
```

### Step 2: Start the Web Interface
```bash
npm run web
```

### Step 3: Open Browser
Go to **http://localhost:3000**

### Step 4: Use the Interface
1. Enter **Start Row** (e.g., 18)
2. Enter **End Row** (e.g., 25)
3. Click **Start Processing**
4. Watch the progress in real-time
5. Check your Google Sheet when done

---

## Quick Start (Command Line)

No Claude AI needed - just use Terminal.

### Step 1: Open Terminal
```bash
cd ~/Work/nodesparks/Projects/Outreach\ Automation
```

### Step 2: Process Leads
```bash
# Process specific rows (e.g., rows 24-28)
node src/index.js --start=24 --limit=5
```

### Step 3: Format the Sheet (optional)
```bash
node src/format-sheet.js
```

### Command Reference

| What you want | Command |
|---------------|---------|
| **Start web interface** | `npm run web` |
| Process rows 30-35 | `node src/index.js --start=30 --limit=6` |
| Process row 50 only | `node src/index.js --start=50 --limit=1` |
| Process all from row 18 | `node src/index.js` |
| Regenerate all emails | `npm run regenerate` |
| Format the table | `npm run format` |

### Example Session (CLI)
```bash
# 1. Navigate to project
cd ~/Work/nodesparks/Projects/Outreach\ Automation

# 2. Process 10 leads starting from row 40
node src/index.js --start=40 --limit=10

# 3. Format the output
npm run format

# 4. Check Google Sheet for results
```

## Google Sheet Structure

### Input: Sheet1
| Column | Field |
|--------|-------|
| A | Channel (set to "email" after processing) |
| C | First Name |
| D | Last Name |
| F | Company Name |
| G | Email |
| N | Website |

### Output: Emails Tab
| Column | Field |
|--------|-------|
| A | Company |
| B | CEO Name |
| C | CEO Email |
| D | Trustpilot URL |
| E | Pain Points |
| F | Email Draft |
| G | Status |

## Usage

### Process Specific Rows
```bash
# Process rows 18-20 (3 rows starting from 18)
node src/index.js --start=18 --limit=3

# Process rows 25-30
node src/index.js --start=25 --limit=6

# Process single row for testing
node src/index.js --start=18 --limit=1
```

### Other Commands
```bash
# Test mode (first company only)
node src/index.js --test

# Process all companies from row 18
node src/index.js

# Regenerate all existing emails with updated template
node src/regenerate-emails.js

# Apply/refresh table formatting
node src/format-sheet.js
```

## File Descriptions

### src/server.js
Express web server providing the browser-based UI. Handles API endpoints for starting/stopping jobs and polling status.

**Endpoints:**
- `GET /api/status` - Get current job status
- `POST /api/start` - Start processing (body: `{startRow, endRow}`)
- `POST /api/stop` - Stop current job

### public/index.html
Modern web interface with real-time progress tracking, activity log, and statistics.

### src/index.js
Main CLI orchestrator. Parses arguments, reads companies, processes each through the pipeline, writes results.

**Arguments:**
- `--start=N` - Start from row N (default: 18)
- `--limit=N` - Process only N companies
- `--test` - Process only first company

### src/sheets.js
Google Sheets API integration.

**Functions:**
- `readCompanies(startRow, limit)` - Read leads from Sheet1
- `writeOutreach(data)` - Write results to Emails tab
- `markAsProcessed(rowNumber)` - Set Column A to "email"
- `updateStatus(company, status)` - Update status column

### src/trustpilot.js
Puppeteer-based Trustpilot scraper.

**Functions:**
- `findTrustpilotPage(website, companyName)` - Find company's Trustpilot URL
- `scrapeReviews(url, stars, maxReviews)` - Scrape reviews by star rating
- `extractPainPoints(reviews)` - Basic keyword-based pain point extraction

### src/emailGen.js
Gemini AI integration for email generation.

**Functions:**
- `generateEmail({company, ceoName, ceoEmail, painPoints, reviews, website})` - Generate cold email
- `analyzeReviewsWithAI(reviews, company)` - AI analysis of technical pain points

### src/format-sheet.js
Applies table formatting to Emails tab (headers, borders, colors, text wrap).

### src/regenerate-emails.js
Re-scrapes and regenerates emails for all existing entries in Emails tab.

## Email Generation Strategy

The email generator uses proven cold email techniques:

### Structure
```
Subject: [4-6 words, lowercase, curiosity-driven]

[Pattern interrupt opening - no greeting]

[Proof paragraph with quoted reviews]

[Technical diagnosis of root cause]

[One-line credential]

[Low-friction CTA question]

- Dan

PS - [Optional hook]
```

### Key Principles
- **No fluff**: No "I hope this finds you well"
- **Specificity**: Quote actual reviews
- **Technical framing**: "Your OMS isn't triggering carrier API" not "bad service"
- **Low-friction CTA**: "Worth a look?" not "Let's schedule a call"
- **Short**: 60-100 words body

## Customization

### Change Email Style
Edit `src/emailGen.js` - modify the prompt in `generateEmail()` function.

### Change Pain Point Analysis
Edit `src/emailGen.js` - modify the prompt in `analyzeReviewsWithAI()` function.

### Change Sheet Columns
Edit `src/sheets.js`:
- `readCompanies()` - Change column indices for input
- `writeOutreach()` - Change column structure for output

### Change Trustpilot Scraping
Edit `src/trustpilot.js`:
- `scrapeReviews()` - Modify selectors or star ratings
- `findTrustpilotPage()` - Modify search logic

## Status Values

| Status | Meaning |
|--------|---------|
| Ready for review | Email generated successfully |
| Skipped - No Trustpilot | Company not found on Trustpilot |
| Skipped - No negative reviews | No 1-2 star reviews found |
| Failed | Error during processing |

## Rate Limiting

- 3 second delay between companies
- 1 second delay between star rating pages
- Respectful scraping with realistic user agent

## Troubleshooting

### "Google Sheets API has not been used"
Enable the Sheets API for your project at:
`https://console.developers.google.com/apis/api/sheets.googleapis.com`

### "Unable to parse range"
Make sure Sheet1 exists and has data in the expected columns.

### "No Trustpilot page found"
The company may not have a Trustpilot profile, or the website URL format doesn't match.

### Gemini API errors
Check your API key is valid and has quota remaining.

## Dependencies

- `express` - Web server for UI
- `googleapis` - Google Sheets API
- `puppeteer` - Web scraping
- `@google/generative-ai` - Gemini AI
- `dotenv` - Environment variables

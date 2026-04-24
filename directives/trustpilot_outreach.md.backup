# Trustpilot Outreach Automation - Standard Operating Procedure

## Overview
This automation generates personalized cold outreach emails to company CEOs by analyzing their negative Trustpilot reviews to identify pain points that can be addressed through business process improvement services.

## Architecture

### Layer 1: Directive (This Document)
Defines the business rules, quality standards, and operational guidelines.

### Layer 2: Orchestration (`src/index.js`)
Controls the workflow:
1. Read companies from Google Sheet
2. For each company: scrape → analyze → generate → write
3. Handle errors and report results

### Layer 3: Execution
- `src/sheets.js` - Google Sheets API integration
- `src/trustpilot.js` - Trustpilot review scraping
- `src/emailGen.js` - Gemini AI email generation

## Workflow

```
┌──────────────────┐
│  Google Sheet    │
│  "Companies"     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Trustpilot      │
│  Scraper         │
│  (1-2 star)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Pain Point      │
│  Analysis        │
│  (AI-powered)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Email           │
│  Generation      │
│  (Gemini)        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Google Sheet    │
│  "Outreach"      │
└──────────────────┘
```

## Input Requirements

### Google Sheet - "Companies" Tab
| Column | Field | Required | Description |
|--------|-------|----------|-------------|
| A | Company | Yes | Company name |
| B | CEO Email | No | Target email address |
| C | Trustpilot URL | Yes | Full Trustpilot review page URL |
| D | Website | No | Company website for context |

## Output Format

### Google Sheet - "Outreach Emails" Tab
| Column | Field | Description |
|--------|-------|-------------|
| A | Company | Company name (from input) |
| B | CEO Email | CEO email (from input) |
| C | Pain Points | AI-identified pain points from reviews |
| D | Generated Email | Full email with subject line |
| E | Status | Processing status |

### Status Values
- `Ready for review` - Email generated successfully
- `Skipped - No negative reviews` - No 1-2 star reviews found
- `Failed` - Error during processing

## Email Quality Standards

### Required Elements
1. **Subject Line**: Specific to company's challenge
2. **Opening**: Direct, no generic greetings
3. **Pain Point Reference**: Subtle mention of identified issue
4. **Value Proposition**: Clear connection to sender's expertise
5. **CTA**: Simple 15-minute call request
6. **Signature**: Professional closing

### Tone Guidelines
- Professional but human
- Empathetic, not condescending
- Solution-focused, not salesy
- Confident, not arrogant

### Length
- 150-200 words maximum
- Short paragraphs (2-3 sentences)

## Sender Context (Used in Email Generation)

**Background:**
- Business Process Architect
- 8 years at Autodoc (large e-commerce)
- Expertise: Gap analysis, automation, silo tax removal
- Focus: E-commerce friction reduction

**Value Proposition:**
- Identify hidden process inefficiencies
- Reduce customer friction points
- Bridge departmental silos
- Implement practical automation

## Operational Notes

### Rate Limiting
- 3-second delay between companies
- 1-second delay between star rating pages
- Respectful scraping with realistic user agent

### Error Handling
- Individual company failures don't stop the batch
- Errors are logged and written to output sheet
- Service continues with next company

### Test Mode
```bash
node src/index.js --test
```
Processes only the first company for verification.

## Maintenance

### Common Issues
1. **Auth Error**: Check credentials.json and sheet sharing
2. **No Reviews Found**: Verify Trustpilot URL format
3. **API Error**: Check Gemini API key and quota
4. **Rate Limited**: Increase delays in code

### Updating Email Template
Edit the prompt in `src/emailGen.js` function `generateEmail()`.

### Adding Pain Point Categories
Update `painPointCategories` object in `src/trustpilot.js`.

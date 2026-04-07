# Troubleshooting Guide

## Issue: "Failed: 14" During Processing

### What Happened
When processing multiple companies at once, 14 companies failed due to:
1. **Timeout errors** - Trustpilot pages took too long to load
2. **Rate limiting** - Too many requests to Trustpilot or Gemini API
3. **Network issues** - Temporary connection problems

### Root Causes
- Original timeouts were too aggressive (15-30 seconds)
- Processing large batches (20+) triggered rate limits
- No retry mechanism for transient failures

---

## ✅ Fixes Applied

### 1. Increased Timeouts in `src/trustpilot.js`
- **Page load timeout**: 15s → 30s
- **Review scraping timeout**: 30s → 60s
- **Review selector wait**: 10s → 15s

These changes handle:
- Slow internet connections
- Trustpilot server delays
- Peak traffic periods

### 2. Created Diagnostic Tool
**File:** `diagnose-and-retry.js`

**Usage:**
```bash
node diagnose-and-retry.js
```

**What it does:**
- Shows processing statistics
- Lists unprocessed companies
- Recommends next batch to process
- Identifies actual failures vs skips

---

## 📋 Current Status

Run `node diagnose-and-retry.js` to see:
- Total emails sent
- Companies skipped (no negative reviews)
- Actual failures
- Next companies to process

**As of last check:**
- ✓ 42 emails sent
- ⊘ 58 skipped (no negative reviews - expected)
- ✗ 0 failed
- 11 companies remaining

---

## 🎯 Best Practices

### 1. Process in Small Batches
**Recommended: 5-10 companies at a time**

```bash
# Safe batch size
node src/index.js --start=164 --limit=5

# Wait 1-2 minutes between batches
node src/index.js --start=169 --limit=5
```

### 2. Why Small Batches?
- **Prevents rate limiting** - Trustpilot won't block you
- **Reduces memory usage** - Fewer browser instances
- **Easier error recovery** - If something fails, less work lost
- **Better monitoring** - See results immediately

### 3. Optimal Workflow
```bash
# 1. Check what needs processing
node diagnose-and-retry.js

# 2. Process first batch (5 companies)
node src/index.js --start=X --limit=5

# 3. Wait 60-90 seconds

# 4. Process next batch
node src/index.js --start=X+5 --limit=5

# 5. Repeat until all processed
```

---

## 🔧 Common Issues & Solutions

### Issue: "No Trustpilot page found"
**Status:** Skipped - No Trustpilot
**Meaning:** Company not on Trustpilot (not a failure)
**Action:** None needed - expected behavior

### Issue: "No negative reviews"
**Status:** Skipped - No negative reviews
**Meaning:** Company has good ratings (not a failure)
**Action:** None needed - can't send outreach without pain points

### Issue: Actual Failures
**Status:** Failed
**Meaning:** Real error occurred
**Action:**
1. Check error message in Emails tab
2. Verify internet connection
3. Check API keys in .env
4. Try processing that company individually:
   ```bash
   node src/index.js --start=ROW_NUMBER --limit=1
   ```

### Issue: Rate Limiting
**Symptoms:**
- Multiple timeouts
- "429 Too Many Requests"
- Slow processing

**Solutions:**
1. Reduce batch size to 3-5
2. Add 2-3 minute delays between batches
3. Process during off-peak hours

---

## 📊 Understanding the Numbers

When you see: "Success: 0, Skipped: 9, Failed: 14"

**This means:**
- **Success (0)** - Companies with negative reviews → email generated → sent
- **Skipped (9)** - Companies without negative reviews (expected, not bad)
- **Failed (14)** - Actual errors (timeout, API issues, etc.)

**Total processed:** 0 + 9 + 14 = 23 companies

---

## 🚀 Recovery Process

If you have failures:

### Step 1: Run Diagnostic
```bash
node diagnose-and-retry.js
```

### Step 2: Check Failed Companies
Look in the Emails tab for entries with "Failed" status.

### Step 3: Retry Failed Companies
Failed companies are NOT marked as processed in Sheet1, so they'll be retried on the next run.

### Step 4: Process Remaining
```bash
# Find first unprocessed row from diagnostic output
node src/index.js --start=ROW --limit=5
```

---

## 🔍 Debug Mode

For detailed error information:

```bash
# Run with Node.js debugging
NODE_DEBUG=* node src/index.js --start=ROW --limit=1

# Or capture all output
node src/index.js --start=ROW --limit=5 2>&1 | tee processing.log
```

---

## ✅ System Health Checklist

Before processing a batch:

- [ ] Internet connection stable
- [ ] `.env` file has valid API keys
- [ ] `credentials.json` exists
- [ ] Google Sheet is accessible
- [ ] Processing in batches of 5-10
- [ ] Waiting 60s+ between batches

---

## 📞 Quick Commands

```bash
# Check system status
node diagnose-and-retry.js

# Process safely (5 at a time)
node src/index.js --start=X --limit=5

# Test single company
node src/index.js --start=X --limit=1

# Process all remaining (risky for large batches)
node src/index.js --start=X

# View format
npm run format
```

---

## 💡 Pro Tips

1. **Weekend Processing:** Less Trustpilot traffic = fewer failures
2. **Monitor Memory:** Close other apps when processing large batches
3. **Track Progress:** Keep a spreadsheet of which batches you've run
4. **Backup Data:** Export Google Sheet regularly
5. **Check Emails Tab:** Verify results after each batch

---

*Last updated: 2026-02-03*
*Fixes applied: Increased timeouts, added diagnostic tool*

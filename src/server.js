#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { readCompanies, readAllLeads, appendLeadsToSheet, writeOutreach, markAsProcessed, writeDraftToLead, getEmailRow, getAllEmails, updateStatus, updateScheduledTime, clearScheduledTime, findFirstUnprocessedRow } from './sheets.js';
import multer from 'multer';
import { createDraft, createDraftWithSignature, updateDraft, deleteDraft, getMyEmail, findDraftByRecipientAndSubject, sendDraft, getGmailClient, getSendAsAddresses } from './gmail.js';
import { findTrustpilotPage, scrapeReviews, extractPainPoints } from './trustpilot.js';
import { generateEmail } from './emailGen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const SETTINGS_PATH = join(PROJECT_ROOT, 'settings.json');

// ============ SETTINGS PERSISTENCE ============

/**
 * Load settings from settings.json and apply to process.env
 */
function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
      if (settings.geminiApiKey) process.env.GEMINI_API_KEY = settings.geminiApiKey;
      if (settings.googleSheetId) process.env.GOOGLE_SHEET_ID = settings.googleSheetId;
      console.log('[SETTINGS] Loaded settings.json (overrides .env)');
      return settings;
    }
  } catch (err) {
    console.error('[SETTINGS] Failed to load settings.json:', err.message);
  }
  return {};
}

/**
 * Save settings to settings.json
 */
function saveSettings(settings) {
  try {
    // Read existing settings to merge
    let existing = {};
    if (existsSync(SETTINGS_PATH)) {
      existing = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    }
    const merged = { ...existing, ...settings };
    writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
    console.log('[SETTINGS] Saved settings.json');
    return merged;
  } catch (err) {
    console.error('[SETTINGS] Failed to save settings.json:', err.message);
    throw err;
  }
}

/**
 * Extract Google Sheet ID from a URL or return the raw ID
 */
function extractSheetId(input) {
  if (!input) return input;
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : input.trim();
}

/**
 * Mask a string showing only last 4 characters
 */
function maskString(str) {
  if (!str || str.length <= 4) return str || '';
  return '*'.repeat(str.length - 4) + str.slice(-4);
}

/**
 * Read service account email from credentials.json
 */
function getServiceAccountInfo() {
  try {
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
    const resolved = join(PROJECT_ROOT, credPath.replace(/^\.\//, ''));
    if (existsSync(resolved)) {
      const creds = JSON.parse(readFileSync(resolved, 'utf8'));
      return { email: creds.client_email || '', connected: true };
    }
  } catch (err) { /* ignore */ }
  return { email: '', connected: false };
}

/**
 * Check if Gmail token exists
 */
function getGmailStatus() {
  const tokenPath = join(PROJECT_ROOT, 'gmail-token.json');
  try {
    if (existsSync(tokenPath)) {
      const token = JSON.parse(readFileSync(tokenPath, 'utf8'));
      return { connected: true, token };
    }
  } catch (err) { /* ignore */ }
  return { connected: false, token: null };
}

// Load settings on startup (overrides .env)
const savedSettings = loadSettings();

const app = express();
app.use(express.json());

// ============ SETTINGS API (must be before static file serving) ============

// GET /api/settings - Return current settings (masked)
app.get('/api/settings', async (req, res) => {
  try {
    const geminiKey = process.env.GEMINI_API_KEY || '';
    const sheetId = process.env.GOOGLE_SHEET_ID || '';
    const serviceAccount = getServiceAccountInfo();
    const gmailStatus = getGmailStatus();

    let gmailEmail = '';
    if (gmailStatus.connected) {
      try {
        gmailEmail = await getMyEmail();
      } catch (err) {
        // Token might be expired or invalid
        gmailEmail = '';
      }
    }

    // Load startRow from settings
    let startRow = 2;
    if (existsSync(SETTINGS_PATH)) {
      try {
        const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
        if (s.startRow) startRow = s.startRow;
      } catch (e) { /* ignore */ }
    }

    res.json({
      geminiApiKey: maskString(geminiKey),
      googleSheetId: sheetId,
      googleSheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : '',
      gmailConnected: gmailStatus.connected && !!gmailEmail,
      gmailEmail: gmailEmail,
      serviceAccountEmail: serviceAccount.email,
      serviceAccountConnected: serviceAccount.connected,
      startRow
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings - Save settings
app.post('/api/settings', async (req, res) => {
  try {
    const { geminiApiKey, googleSheetId } = req.body;
    const toSave = {};

    if (geminiApiKey !== undefined && !geminiApiKey.startsWith('*')) {
      toSave.geminiApiKey = geminiApiKey;
      process.env.GEMINI_API_KEY = geminiApiKey;
    }

    if (googleSheetId !== undefined) {
      const id = extractSheetId(googleSheetId);
      toSave.googleSheetId = id;
      process.env.GOOGLE_SHEET_ID = id;
    }

    const saved = saveSettings(toSave);
    res.json({ success: true, settings: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/test-gemini - Test Gemini API key
app.post('/api/settings/test-gemini', async (req, res) => {
  try {
    const { apiKey } = req.body;
    const key = apiKey && !apiKey.startsWith('*') ? apiKey : process.env.GEMINI_API_KEY;

    if (!key) {
      return res.json({ valid: false, error: 'No API key provided' });
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    await model.generateContent('Say "ok" in one word.');

    res.json({ valid: true });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

// POST /api/settings/test-sheet - Test Google Sheet connection
app.post('/api/settings/test-sheet', async (req, res) => {
  try {
    const { sheetId } = req.body;
    const id = sheetId ? extractSheetId(sheetId) : process.env.GOOGLE_SHEET_ID;

    if (!id) {
      return res.json({ valid: false, error: 'No Sheet ID provided' });
    }

    const { google } = await import('googleapis');
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
    const resolved = join(PROJECT_ROOT, credPath.replace(/^\.\//, ''));
    const credentials = JSON.parse(readFileSync(resolved, 'utf8'));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: 'Sheet1!A1:A',
    });

    const rowCount = response.data.values ? response.data.values.length : 0;
    res.json({ valid: true, rowCount });

    // Auto-format the sheet in the background
    try {
      const formatRes = await fetch(`http://localhost:${PORT}/api/settings/format-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: id })
      });
    } catch (e) { /* best effort */ }
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

// POST /api/settings/gmail-auth - Trigger Gmail OAuth flow
app.post('/api/settings/gmail-auth', async (req, res) => {
  try {
    res.json({ message: 'Gmail OAuth flow started. Check your browser for authorization.' });
    // Trigger the OAuth flow (opens browser)
    await getGmailClient();
  } catch (err) {
    // Don't send error since we already sent the initial response
    console.error('[SETTINGS] Gmail auth error:', err.message);
  }
});

// POST /api/settings/gmail-disconnect - Remove Gmail token
app.post('/api/settings/gmail-disconnect', (req, res) => {
  try {
    const tokenPath = join(PROJECT_ROOT, 'gmail-token.json');
    if (existsSync(tokenPath)) {
      unlinkSync(tokenPath);
    }
    res.json({ success: true, message: 'Gmail disconnected. Token removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/gmail-send-as - List available send-as addresses
app.get('/api/settings/gmail-send-as', async (req, res) => {
  try {
    // Check if Gmail is authorized before attempting (avoids triggering OAuth flow)
    const tokenPath = join(PROJECT_ROOT, 'gmail-token.json');
    if (!existsSync(tokenPath)) {
      return res.json({ addresses: [], savedSender: '', error: 'Gmail not connected' });
    }
    const addresses = await getSendAsAddresses();
    // Load saved sender preference
    let savedSender = '';
    if (existsSync(SETTINGS_PATH)) {
      try {
        const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
        savedSender = s.sendFromEmail || '';
      } catch (e) { /* ignore */ }
    }
    res.json({ addresses, savedSender });
  } catch (err) {
    res.status(500).json({ error: err.message, addresses: [] });
  }
});

// POST /api/settings/send-from - Save the selected send-from email
app.post('/api/settings/send-from', (req, res) => {
  try {
    const { email } = req.body;
    const saved = saveSettings({ sendFromEmail: email || '' });
    res.json({ success: true, sendFromEmail: email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/format-sheet - Auto-format Sheet1 with clean layout
app.post('/api/settings/format-sheet', async (req, res) => {
  try {
    const sheetId = req.body.sheetId ? extractSheetId(req.body.sheetId) : process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return res.json({ success: false, error: 'No Sheet ID' });

    const { google } = await import('googleapis');
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
    const credentials = JSON.parse(readFileSync(join(PROJECT_ROOT, credPath.replace(/^\.\//, '')), 'utf8'));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });

    // Get Sheet1 sheetId
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheet1 = spreadsheet.data.sheets.find(s => s.properties.title === 'Sheet1');
    if (!sheet1) return res.json({ success: false, error: 'Sheet1 not found' });
    const sheet1Id = sheet1.properties.sheetId;

    // Check if headers match expected format
    const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A1:F1' });
    const headers = headerRes.data.values?.[0] || [];
    const expectedHeaders = ['Status', 'First Name', 'Last Name', 'Company', 'Email', 'Website'];

    // If headers don't match, set them
    if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1:F1',
        valueInputOption: 'RAW',
        requestBody: { values: [expectedHeaders] }
      });
    }

    // Get row count for formatting range
    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:A' });
    const rowCount = Math.max((dataRes.data.values || []).length, 2);

    const borderStyle = { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } };

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          { updateSheetProperties: { properties: { sheetId: sheet1Id, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
          // Header style
          { repeatCell: {
            range: { sheetId: sheet1Id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
            cell: { userEnteredFormat: {
              backgroundColor: { red: 0.13, green: 0.13, blue: 0.16 },
              textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 0.9, green: 0.93, blue: 0.95 }, fontFamily: 'Inter' },
              horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
              padding: { top: 10, bottom: 10, left: 12, right: 12 }
            }},
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)'
          }},
          // Data cells
          { repeatCell: {
            range: { sheetId: sheet1Id, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 6 },
            cell: { userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 1 },
              textFormat: { fontSize: 10, fontFamily: 'Inter' },
              verticalAlignment: 'MIDDLE',
              padding: { top: 8, bottom: 8, left: 12, right: 12 }
            }},
            fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)'
          }},
          // Alternating row colors
          ...Array.from({ length: Math.ceil(rowCount / 2) }, (_, i) => ({
            repeatCell: {
              range: { sheetId: sheet1Id, startRowIndex: 2 + i * 2, endRowIndex: Math.min(3 + i * 2, rowCount), startColumnIndex: 0, endColumnIndex: 6 },
              cell: { userEnteredFormat: { backgroundColor: { red: 0.976, green: 0.98, blue: 0.988 } } },
              fields: 'userEnteredFormat.backgroundColor'
            }
          })),
          // Borders
          { updateBorders: { range: { sheetId: sheet1Id, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 6 }, top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle, innerHorizontal: borderStyle, innerVertical: borderStyle } },
          { updateBorders: { range: { sheetId: sheet1Id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 }, bottom: { style: 'SOLID', width: 2, color: { red: 0.3, green: 0.3, blue: 0.35 } } } },
          // Column widths
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 90 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 280 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: sheet1Id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
        ]
      }
    });

    res.json({ success: true, rowCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Static file serving (AFTER settings API)
app.use(express.static(join(__dirname, '../public')));

// Store active job status
let currentJob = {
  running: false,
  progress: 0,
  total: 0,
  current: '',
  logs: [],
  results: { successful: 0, skipped: 0, failed: 0 },
  leads: [] // per-lead status: { rowNumber, company, email, website, status, detail }
};

// Store draft job status
let draftJob = {
  running: false,
  progress: 0,
  total: 0,
  current: '',
  logs: [],
  results: { drafted: 0, skipped: 0, failed: 0 },
  gmailConnected: false,
  gmailEmail: ''
};

// Store schedule job status
let scheduleJob = {
  running: false,
  progress: 0,
  total: 0,
  logs: [],
  results: { sent: 0, failed: 0, pending: 0 },
  scheduledEmails: [],  // { company, ceoEmail, subject, scheduledTime, status, timeoutId }
  settings: {
    timezone: 'America/New_York',
    startTime: '09:00',
    endTime: '17:00',
    minInterval: 15,
    maxInterval: 25
  }
};

// STRICT DUPLICATE PREVENTION: Track all emails ever sent in this session
// Key: email address (lowercase), Value: { company, sentAt }
const sentEmailAddresses = new Map();

// Store recovery status
let recoveryStatus = {
  recovered: 0,
  rescheduled: 0,
  expired: 0,
  lastRecovery: null,
  details: []
};

/**
 * Sync in-memory scheduledEmails with actual sheet data
 * Removes stale entries that no longer exist or have wrong status
 */
async function syncScheduledEmailsWithSheet() {
  if (scheduleJob.scheduledEmails.length === 0) return;

  try {
    const sheetEmails = await getAllEmails();
    const sheetMap = new Map();

    // Build a map of sheet data: company -> { status, email }
    for (const email of sheetEmails) {
      sheetMap.set(email.company, {
        status: (email.status || '').toLowerCase().trim(),
        email: email.ceoEmail
      });
    }

    // Find entries to remove
    const toRemove = [];
    for (let i = 0; i < scheduleJob.scheduledEmails.length; i++) {
      const scheduled = scheduleJob.scheduledEmails[i];
      const sheetData = sheetMap.get(scheduled.company);

      // Remove if: not in sheet, or status is not "scheduled", or already sent/failed
      const shouldRemove =
        !sheetData ||
        sheetData.status !== 'scheduled' ||
        scheduled.status === 'sent' ||
        scheduled.status === 'failed' ||
        scheduled.status === 'cancelled';

      if (shouldRemove) {
        // Clear the timeout if it exists
        if (scheduled.timeoutId) {
          clearTimeout(scheduled.timeoutId);
        }
        toRemove.push(i);
        console.log(`[SYNC] Removing stale entry: ${scheduled.company} (sheet status: ${sheetData?.status || 'not found'}, memory status: ${scheduled.status})`);
      }
    }

    // Remove entries in reverse order to maintain correct indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      scheduleJob.scheduledEmails.splice(toRemove[i], 1);
    }

    // Update pending count
    scheduleJob.results.pending = scheduleJob.scheduledEmails.filter(e => e.status === 'pending').length;

    if (toRemove.length > 0) {
      console.log(`[SYNC] Removed ${toRemove.length} stale entries. ${scheduleJob.scheduledEmails.length} remaining.`);
    }
  } catch (error) {
    console.error('[SYNC] Error syncing with sheet:', error.message);
  }
}

function draftLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  draftJob.logs.push({ time: timestamp, message });
  console.log(`[DRAFT ${timestamp}] ${message}`);
}

function scheduleLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  scheduleJob.logs.push({ time: timestamp, message });
  console.log(`[SCHEDULE ${timestamp}] ${message}`);
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  currentJob.logs.push({ time: timestamp, message });
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Parse a formatted date string from the sheet back to a Date object
 * Format: "Jan 25, 2026, 2:00 PM" (from Intl.DateTimeFormat)
 */
function parseScheduledTimeFromSheet(timeStr, timezone = 'America/New_York') {
  if (!timeStr) return null;

  try {
    // Parse "Jan 25, 2026, 2:00 PM" format
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    // Manual parsing as fallback
    // Format: "Mon DD, YYYY, H:MM AM/PM"
    const match = timeStr.match(/(\w+)\s+(\d+),\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)/i);
    if (match) {
      const [, month, day, year, hour, minute, ampm] = match;
      const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
      let h = parseInt(hour);
      if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
      if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;

      return new Date(parseInt(year), months[month], parseInt(day), h, parseInt(minute));
    }

    return null;
  } catch (e) {
    console.error(`Failed to parse scheduled time: ${timeStr}`, e);
    return null;
  }
}

/**
 * Roll a date forward by 24 hours until it's in the future
 */
function rollForwardToFuture(date) {
  const now = new Date();
  const rolled = new Date(date);
  let daysAdded = 0;

  while (rolled <= now) {
    rolled.setDate(rolled.getDate() + 1);
    daysAdded++;
  }

  return { date: rolled, daysAdded };
}

/**
 * Recover scheduled emails from the sheet on server startup
 * - Future times: re-schedule normally
 * - Past ≤ 7 days: roll forward to same time (add 24h until future)
 * - Past > 7 days: mark as "Expired"
 */
async function recoverScheduledEmails() {
  console.log('\n[RECOVERY] Checking for scheduled emails to recover...');

  try {
    const allEmails = await getAllEmails();
    // Case-insensitive status check
    const scheduledEmails = allEmails.filter(e =>
      (e.status || '').toLowerCase().trim() === 'scheduled'
    );

    if (scheduledEmails.length === 0) {
      console.log('[RECOVERY] No scheduled emails found to recover.');
      return;
    }

    console.log(`[RECOVERY] Found ${scheduledEmails.length} scheduled email(s) to check.`);

    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const timezone = scheduleJob.settings.timezone || 'America/New_York';

    // Reset recovery status
    recoveryStatus = {
      recovered: 0,
      rescheduled: 0,
      expired: 0,
      lastRecovery: new Date().toISOString(),
      details: []
    };

    // Prepare scheduleJob for recovered emails
    scheduleJob.running = true;
    scheduleJob.scheduledEmails = [];
    scheduleJob.results = { sent: 0, failed: 0, pending: 0 };
    scheduleJob.logs = [];

    for (const email of scheduledEmails) {
      const scheduledTime = parseScheduledTimeFromSheet(email.scheduledTime, timezone);

      if (!scheduledTime) {
        console.log(`[RECOVERY] Could not parse time for ${email.company}: "${email.scheduledTime}"`);
        recoveryStatus.details.push({
          company: email.company,
          action: 'skipped',
          reason: 'Could not parse scheduled time'
        });
        continue;
      }

      const timeDiff = now - scheduledTime;
      const subject = parseEmailDraft(email.email).subject;

      if (scheduledTime > now) {
        // Future time - re-schedule normally
        const delayMs = scheduledTime - now;

        const scheduledEmail = {
          company: email.company,
          ceoEmail: email.ceoEmail,
          subject,
          scheduledTime: scheduledTime.toISOString(),
          status: 'pending'
        };

        scheduledEmail.timeoutId = setTimeout(() => {
          scheduleLog(`[TIMEOUT EXECUTING] ${scheduledEmail.company}`);
          sendScheduledEmail(scheduledEmail);
        }, delayMs);

        scheduleJob.scheduledEmails.push(scheduledEmail);
        scheduleJob.results.pending++;

        console.log(`[RECOVERY] Restored: ${email.company} - scheduled for ${scheduledTime.toLocaleString()}`);
        recoveryStatus.recovered++;
        recoveryStatus.details.push({
          company: email.company,
          action: 'restored',
          originalTime: scheduledTime.toISOString()
        });

      } else if (timeDiff <= sevenDaysMs) {
        // Past but within 7 days - roll forward
        const { date: newTime, daysAdded } = rollForwardToFuture(scheduledTime);
        const delayMs = newTime - now;

        const scheduledEmail = {
          company: email.company,
          ceoEmail: email.ceoEmail,
          subject,
          scheduledTime: newTime.toISOString(),
          status: 'pending'
        };

        scheduledEmail.timeoutId = setTimeout(() => {
          scheduleLog(`[TIMEOUT EXECUTING] ${scheduledEmail.company}`);
          sendScheduledEmail(scheduledEmail);
        }, delayMs);

        scheduleJob.scheduledEmails.push(scheduledEmail);
        scheduleJob.results.pending++;

        // Update the sheet with new time
        await updateScheduledTime(email.company, newTime.toISOString(), timezone);

        console.log(`[RECOVERY] Rescheduled: ${email.company} - was ${scheduledTime.toLocaleString()}, now ${newTime.toLocaleString()} (+${daysAdded} day(s))`);
        recoveryStatus.rescheduled++;
        recoveryStatus.details.push({
          company: email.company,
          action: 'rescheduled',
          originalTime: scheduledTime.toISOString(),
          newTime: newTime.toISOString(),
          daysAdded
        });

      } else {
        // Past by more than 7 days - mark as expired
        await updateStatus(email.company, 'Expired - Server was down');

        console.log(`[RECOVERY] Expired: ${email.company} - was scheduled for ${scheduledTime.toLocaleString()} (${Math.floor(timeDiff / (24 * 60 * 60 * 1000))} days ago)`);
        recoveryStatus.expired++;
        recoveryStatus.details.push({
          company: email.company,
          action: 'expired',
          originalTime: scheduledTime.toISOString(),
          daysOverdue: Math.floor(timeDiff / (24 * 60 * 60 * 1000))
        });
      }
    }

    scheduleJob.total = scheduleJob.scheduledEmails.length;

    // Recovery complete - set running to false (we're now just waiting for timeouts)
    scheduleJob.running = false;

    console.log(`[RECOVERY] Complete: ${recoveryStatus.recovered} restored, ${recoveryStatus.rescheduled} rescheduled, ${recoveryStatus.expired} expired`);
    scheduleLog(`Recovery complete: ${recoveryStatus.recovered} restored, ${recoveryStatus.rescheduled} rescheduled, ${recoveryStatus.expired} expired`);

  } catch (error) {
    console.error('[RECOVERY] Error during recovery:', error);
  }
}

// API: Get all leads from Sheet1
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await readAllLeads(2);

    // Enrich with scheduled time from Emails tab
    try {
      const emailsData = await getAllEmails();
      const emailMap = new Map();
      for (const e of emailsData) {
        if (e.ceoEmail) emailMap.set(e.ceoEmail.toLowerCase(), e);
      }
      for (const lead of leads) {
        const match = emailMap.get((lead.email || '').toLowerCase());
        if (match) {
          lead.scheduledTime = match.scheduledTime || '';
          lead.scheduleStatus = match.status || '';
        }
      }
    } catch (e) {
      // Emails tab may not exist yet — that's OK
    }

    // Include the user's selected timezone
    const tz = scheduleJob.settings.timezone || 'America/New_York';
    res.json({ leads, timezone: tz });
  } catch (error) {
    res.status(500).json({ error: error.message, leads: [] });
  }
});

// API: Import leads from CSV/XML file upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/import-leads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const content = req.file.buffer.toString('utf-8');
    const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
    let leads = [];

    if (ext === 'csv' || req.file.mimetype === 'text/csv') {
      // Parse CSV — handle quoted fields
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

      // Parse header to detect columns
      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

      // Column detection: use exact match first, then fuzzy fallback
      // This handles Apollo.io exports where "Company Name for Emails" contains "email"
      // and "Person Linkedin Url" contains "url"
      function findCol(exactPatterns, fuzzyPatterns = []) {
        // Try exact matches first (higher priority)
        for (const pat of exactPatterns) {
          const idx = header.findIndex(h => pat.test(h));
          if (idx >= 0) return idx;
        }
        // Fuzzy fallback
        for (const pat of fuzzyPatterns) {
          const idx = header.findIndex(h => pat.test(h));
          if (idx >= 0) return idx;
        }
        return -1;
      }

      const colMap = {
        firstName: findCol([/^first.?name$/], [/^first$/]),
        lastName: findCol([/^last.?name$/], [/^last$/, /^surname$/]),
        company: findCol([/^company$/, /^company.?name$/], [/^business$/, /^organization$/]),
        // Email: must be exactly "email" or "e-mail" — NOT "company name for emails"
        email: findCol([/^email$/, /^e-?mail$/, /^email.?address$/]),
        // Website: must be exactly "website" — NOT "person linkedin url" or any social URL column
        website: findCol([/^website$/, /^company.?website$/], [/^web$/, /^site$/, /^domain$/]),
        name: findCol([/^name$/]),
      };

      // Debug: log detected column mapping
      console.log(`  CSV headers (first 10): ${JSON.stringify(header.slice(0, 10))}`);
      console.log(`  Column mapping: firstName=${colMap.firstName}, lastName=${colMap.lastName}, company=${colMap.company}, email=${colMap.email}, website=${colMap.website}`);

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (!cols.length) continue;

        let firstName = colMap.firstName >= 0 ? (cols[colMap.firstName] || '').trim() : '';
        let lastName = colMap.lastName >= 0 ? (cols[colMap.lastName] || '').trim() : '';

        // If no first/last but has "name", split it
        if (!firstName && !lastName && colMap.name >= 0) {
          const parts = (cols[colMap.name] || '').trim().split(/\s+/);
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ');
        }

        const company = colMap.company >= 0 ? (cols[colMap.company] || '').trim() : '';
        let email = colMap.email >= 0 ? (cols[colMap.email] || '').trim() : '';
        let website = colMap.website >= 0 ? (cols[colMap.website] || '').trim() : '';

        // Validate: email must contain @, otherwise discard (it's probably a wrong column)
        if (email && !email.includes('@')) email = '';

        // Validate: website must not be a social media profile URL
        if (website && /linkedin|facebook|twitter|instagram|tiktok|youtube/i.test(website)) website = '';

        if (company || email) {
          leads.push({ firstName, lastName, company, email, website });
        }
      }
    } else if (ext === 'xml' || req.file.mimetype === 'text/xml' || req.file.mimetype === 'application/xml') {
      // Simple XML parser — extract <lead> or <row> elements
      const tagPattern = /<(?:lead|row|contact|record)[^>]*>([\s\S]*?)<\/(?:lead|row|contact|record)>/gi;
      let match;
      while ((match = tagPattern.exec(content)) !== null) {
        const block = match[1];
        const get = (tag) => {
          const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
          return m ? m[1].trim() : '';
        };
        const firstName = get('firstName') || get('first_name') || get('first');
        const lastName = get('lastName') || get('last_name') || get('last');
        const company = get('company') || get('business') || get('organization');
        const email = get('email');
        const website = get('website') || get('url') || get('domain');

        if (company || email) {
          leads.push({ firstName, lastName, company, email, website });
        }
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use CSV or XML.' });
    }

    // Filter: require both email and website
    const valid = [];
    const skipped = [];

    for (const lead of leads) {
      const missing = [];
      if (!lead.email) missing.push('email');
      if (!lead.website) missing.push('website');

      if (missing.length > 0) {
        const identifier = lead.company || lead.firstName || lead.lastName || '(unnamed)';
        skipped.push({ name: identifier, missing });
      } else {
        valid.push(lead);
      }
    }

    if (valid.length === 0) {
      return res.status(400).json({
        error: 'No valid leads found. All rows are missing email or website.',
        totalParsed: leads.length,
        skipped: skipped.length,
        skippedDetails: skipped.slice(0, 20)
      });
    }

    const count = await appendLeadsToSheet(valid);
    res.json({
      success: true,
      imported: count,
      totalParsed: leads.length,
      skipped: skipped.length,
      skippedDetails: skipped.slice(0, 30)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Redraft a single lead — regenerate email + replace Gmail draft
app.post('/api/redraft', async (req, res) => {
  const { rowNumber } = req.body;
  if (!rowNumber) return res.status(400).json({ error: 'rowNumber required' });

  try {
    // Read the lead data from the sheet
    const leads = await readAllLeads(rowNumber);
    const lead = leads.find(l => l.rowNumber === parseInt(rowNumber));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Need a Trustpilot URL to rescrape, or at least the old email data
    if (!lead.trustpilotUrl) {
      return res.status(400).json({ error: 'No Trustpilot URL — cannot regenerate email' });
    }

    // Scrape fresh reviews
    const reviews = await scrapeReviews(lead.trustpilotUrl, [1, 2], 20);
    if (reviews.length === 0) {
      return res.status(400).json({ error: 'No negative reviews found on rescrape' });
    }

    // Regenerate email
    const ceoName = `${lead.firstName} ${lead.lastName}`.trim();
    const emailResult = await generateEmail({
      ceoName,
      reviews,
      company: lead.company
    });

    const variantA = emailResult?.variants?.A?.email || (typeof emailResult === 'string' ? emailResult : '');
    const { subject, body } = parseEmailDraft(typeof emailResult === 'object' ? JSON.stringify(emailResult) : variantA);

    if (!subject || !body) {
      return res.status(400).json({ error: 'Generated email was empty' });
    }

    // Replace or create Gmail draft
    let newDraftId = '';
    let sendFrom = '';
    try { sendFrom = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')).sendFromEmail || ''; } catch(e) {}

    if (lead.draftId) {
      // Try to update existing draft
      try {
        const updated = await updateDraft(lead.draftId, lead.email, subject, body, sendFrom || undefined);
        newDraftId = updated.id || lead.draftId;
      } catch (err) {
        // If update fails (draft deleted?), create new one
        const draft = await createDraftWithSignature(lead.email, subject, body, sendFrom || undefined);
        newDraftId = draft.id || '';
      }
    } else if (lead.email) {
      const draft = await createDraftWithSignature(lead.email, subject, body, sendFrom || undefined);
      newDraftId = draft.id || '';
    }

    // Update Sheet1
    await writeDraftToLead(parseInt(rowNumber), {
      trustpilotUrl: lead.trustpilotUrl,
      emailDraft: typeof emailResult === 'object' ? JSON.stringify(emailResult) : variantA,
      draftId: newDraftId
    });
    await markAsProcessed(parseInt(rowNumber), 'Drafted');

    res.json({ success: true, draftId: newDraftId, subject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Parse a single CSV line respecting quoted fields */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

// API: Get current status (includes per-lead status)
app.get('/api/status', (req, res) => {
  res.json(currentJob);
});

// API: Start processing — accepts { rows: [2,3,5] } or { startRow, endRow }
app.post('/api/start', async (req, res) => {
  const { startRow, endRow, rows } = req.body;

  if (currentJob.running) {
    return res.status(400).json({ error: 'Job already running' });
  }

  // If specific rows provided, use them; otherwise fall back to range
  if (rows && Array.isArray(rows) && rows.length > 0) {
    const rowNumbers = rows.map(r => parseInt(r)).filter(r => r > 0).sort((a, b) => a - b);

    currentJob = {
      running: true,
      progress: 0,
      total: rowNumbers.length,
      current: '',
      logs: [],
      results: { successful: 0, skipped: 0, failed: 0 },
      leads: []
    };

    res.json({ message: 'Job started', rows: rowNumbers });

    processSelectedRows(rowNumbers).catch(err => {
      log(`Fatal error: ${err.message}`);
      currentJob.running = false;
    });
  } else {
    const start = parseInt(startRow) || 2;
    const end = parseInt(endRow) || start;
    const limit = end - start + 1;

    currentJob = {
      running: true,
      progress: 0,
      total: limit,
      current: '',
      logs: [],
      results: { successful: 0, skipped: 0, failed: 0 },
      leads: []
    };

    res.json({ message: 'Job started', startRow: start, endRow: end });

    processCompanies(start, limit).catch(err => {
      log(`Fatal error: ${err.message}`);
      currentJob.running = false;
    });
  }
});

// API: Stop processing
app.post('/api/stop', (req, res) => {
  if (currentJob.running) {
    currentJob.running = false;
    log('Job stopped by user');
    res.json({ message: 'Job stopped' });
  } else {
    res.json({ message: 'No job running' });
  }
});

// API: Get all emails from Emails tab
app.get('/api/emails', async (req, res) => {
  try {
    const emails = await getAllEmails();
    res.json({ emails });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get first unprocessed row (where Column A is empty in Sheet1)
app.get('/api/first-unprocessed-row', async (req, res) => {
  try {
    const startFrom = parseInt(req.query.startFrom) || 2;
    const row = await findFirstUnprocessedRow(startFrom);
    res.json({ row });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DRAFT EMAILS API ============

// API: Get draft job status
app.get('/api/draft/status', (req, res) => {
  res.json(draftJob);
});

// API: Check Gmail connection
app.get('/api/draft/check', async (req, res) => {
  try {
    const email = await getMyEmail();
    res.json({ connected: true, email });
  } catch (error) {
    res.json({ connected: false, error: error.message });
  }
});

// API: Start drafting emails
app.post('/api/draft/start', async (req, res) => {
  const { mode } = req.body;

  if (draftJob.running) {
    return res.status(400).json({ error: 'Draft job already running' });
  }

  // Reset draft job state
  draftJob = {
    running: true,
    progress: 0,
    total: 0,
    current: '',
    logs: [],
    results: { drafted: 0, skipped: 0, failed: 0 },
    gmailConnected: false,
    gmailEmail: ''
  };

  res.json({ message: 'Draft job started', mode });

  // Process in background
  processDrafts(mode).catch(err => {
    draftLog(`Fatal error: ${err.message}`);
    draftJob.running = false;
  });
});

// API: Stop drafting
app.post('/api/draft/stop', (req, res) => {
  if (draftJob.running) {
    draftJob.running = false;
    draftLog('Draft job stopped by user');
    res.json({ message: 'Draft job stopped' });
  } else {
    res.json({ message: 'No draft job running' });
  }
});

// ============ DEBUG API ============

// DEBUG: Test find + send in isolation (bypasses all scheduling)
app.post('/api/debug/find-and-send', async (req, res) => {
  const { email, subject } = req.body;
  const results = { steps: [] };

  console.log(`[DEBUG] Testing find+send for: ${email}, subject: "${subject}"`);

  try {
    // Step 1: List all drafts
    const gmail = await getGmailClient();
    const draftsResp = await gmail.users.drafts.list({ userId: 'me', maxResults: 10 });
    const draftCount = draftsResp.data.drafts?.length || 0;
    results.steps.push({ step: 'list_drafts', count: draftCount });
    console.log(`[DEBUG] Found ${draftCount} drafts total`);

    // Step 2: Try to find the specific draft
    const draft = await findDraftByRecipientAndSubject(email, subject);
    results.steps.push({
      step: 'find_draft',
      found: !!draft,
      draftId: draft?.id,
      foundSubject: draft?.subject
    });
    console.log(`[DEBUG] Find result: ${draft ? `FOUND id=${draft.id}` : 'NOT FOUND'}`);

    if (!draft) {
      // Step 2b: Show what drafts DO exist for debugging
      const allDrafts = [];
      for (const d of (draftsResp.data.drafts || []).slice(0, 5)) {
        const detail = await gmail.users.drafts.get({
          userId: 'me', id: d.id, format: 'metadata',
          metadataHeaders: ['To', 'Subject']
        });
        const headers = detail.data.message?.payload?.headers || [];
        allDrafts.push({
          id: d.id,
          to: headers.find(h => h.name.toLowerCase() === 'to')?.value,
          subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value
        });
      }
      results.existingDrafts = allDrafts;
      results.searchedFor = { email, subjectFirst30: subject.substring(0, 30) };
      console.log(`[DEBUG] Existing drafts:`, JSON.stringify(allDrafts, null, 2));
      return res.json({ success: false, error: 'Draft not found', results });
    }

    // Step 3: Try to send it
    console.log(`[DEBUG] Attempting to send draft ${draft.id}...`);
    const sendResult = await sendDraft(draft.id);
    results.steps.push({
      step: 'send_draft',
      messageId: sendResult.id,
      threadId: sendResult.threadId,
      labelIds: sendResult.labelIds
    });
    console.log(`[DEBUG] Send result:`, JSON.stringify(sendResult, null, 2));

    res.json({ success: true, message: 'Email sent successfully!', results });
  } catch (error) {
    console.error(`[DEBUG] Error:`, error);
    results.error = { message: error.message, stack: error.stack };
    res.status(500).json({ success: false, results });
  }
});

// DEBUG: List all Gmail drafts
app.get('/api/debug/drafts', async (req, res) => {
  try {
    const gmail = await getGmailClient();
    const draftsResp = await gmail.users.drafts.list({ userId: 'me', maxResults: 20 });
    const drafts = [];

    for (const d of (draftsResp.data.drafts || [])) {
      const detail = await gmail.users.drafts.get({
        userId: 'me', id: d.id, format: 'metadata',
        metadataHeaders: ['To', 'Subject']
      });
      const headers = detail.data.message?.payload?.headers || [];
      drafts.push({
        id: d.id,
        to: headers.find(h => h.name.toLowerCase() === 'to')?.value,
        subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value
      });
    }

    res.json({ count: drafts.length, drafts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DEBUG: Send a specific draft by ID directly
app.post('/api/debug/send-by-id', async (req, res) => {
  const { draftId } = req.body;

  if (!draftId) {
    return res.status(400).json({ error: 'draftId required' });
  }

  try {
    console.log(`[DEBUG] Sending draft by ID: ${draftId}`);
    const result = await sendDraft(draftId);
    console.log(`[DEBUG] Send result:`, result);
    res.json({ success: true, result });
  } catch (error) {
    console.error(`[DEBUG] Send error:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ SCHEDULED SENDING API ============

// API: Create test draft for scheduling
app.post('/api/schedule/test-draft', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email address required' });
  }

  try {
    const subject = `Test Schedule - ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
    const body = `This is a test email for the scheduled sending feature.\n\nSent at: ${new Date().toLocaleString()}`;

    // Create draft in Gmail (use saved sender if set)
    let sendFrom = '';
    try { sendFrom = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')).sendFromEmail || ''; } catch(e) {}
    await createDraftWithSignature(email, subject, body, sendFrom || undefined);

    // Also add to sheet as "Drafted" status
    await writeOutreach({
      company: 'Test Company',
      ceoName: 'Test User',
      ceoEmail: email,
      trustpilotUrl: '',
      painPoints: 'Test draft for scheduling',
      generatedEmail: `Subject: ${subject}\n\n${body}`,
      status: 'Drafted'
    });

    res.json({
      success: true,
      message: `Test draft created for ${email}`,
      subject
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Timezone mappings (supports both IANA format and legacy shorthand)
const TIMEZONE_MAP = {
  // IANA format values (pass through)
  'America/New_York': 'America/New_York',
  'America/Los_Angeles': 'America/Los_Angeles',
  'America/Chicago': 'America/Chicago',
  'America/Denver': 'America/Denver',
  'Europe/London': 'Europe/London',
  'Europe/Paris': 'Europe/Paris',
  // Legacy shorthand (backward compatibility)
  'ET': 'America/New_York',
  'CT': 'America/Chicago',
  'MT': 'America/Denver',
  'PT': 'America/Los_Angeles',
  'London': 'Europe/London',
  'Paris': 'Europe/Paris'
};

// Sync caching - only sync every 30 seconds to avoid quota limits
const SYNC_INTERVAL_MS = 30000; // 30 seconds
let lastSyncTime = 0;

// API: Get schedule job status
app.get('/api/schedule/status', async (req, res) => {
  // Only sync if enough time has passed (avoids hitting Google Sheets quota)
  const now = Date.now();
  if (now - lastSyncTime > SYNC_INTERVAL_MS) {
    await syncScheduledEmailsWithSheet();
    lastSyncTime = now;
  }

  // Remove timeoutId from scheduled emails to avoid circular JSON error
  const sanitizedJob = {
    ...scheduleJob,
    scheduledEmails: scheduleJob.scheduledEmails.map(email => ({
      company: email.company,
      ceoEmail: email.ceoEmail,
      subject: email.subject,
      scheduledTime: email.scheduledTime,
      status: email.status,
      error: email.error
    }))
  };
  res.json(sanitizedJob);
});

// API: Get recovery status (from last server startup)
app.get('/api/schedule/recovery', (req, res) => {
  const timezone = scheduleJob.settings.timezone || 'America/New_York';
  res.json({ ...recoveryStatus, timezone });
});

// API: Manually trigger recovery (re-scan sheet for scheduled emails)
app.post('/api/schedule/recover', async (req, res) => {
  try {
    await recoverScheduledEmails();
    res.json({
      success: true,
      ...recoveryStatus
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Preview schedule (calculate times without committing)
app.post('/api/schedule/preview', async (req, res) => {
  const { timezone, scheduleDate, startTime, endTime, minInterval, maxInterval, filterEmail } = req.body;

  // Validation: End time must be after start time
  if (endTime <= startTime) {
    return res.status(400).json({
      error: 'End time must be later than start time.'
    });
  }

  try {
    // Get all drafted emails
    const allEmails = await getAllEmails();
    console.log(`[PREVIEW] Found ${allEmails.length} total emails`);

    // Filter by status - case-insensitive and trim whitespace
    let draftedEmails = allEmails.filter(e => {
      const status = (e.status || '').toLowerCase().trim();
      return status === 'drafted';
    });
    console.log(`[PREVIEW] Found ${draftedEmails.length} emails with Drafted status`);

    // Filter by specific email if provided (for testing)
    if (filterEmail) {
      draftedEmails = draftedEmails.filter(e =>
        e.ceoEmail.toLowerCase().includes(filterEmail.toLowerCase())
      );
    }

    if (draftedEmails.length === 0) {
      return res.json({
        emails: [],
        warning: 'No drafted emails found. Create drafts first.'
      });
    }

    // Calculate schedule times
    const tz = TIMEZONE_MAP[timezone] || timezone || 'America/New_York';
    const settings = {
      timezone: tz,
      scheduleDate: scheduleDate || new Date().toISOString().slice(0, 10),
      startTime: startTime || '09:00',
      endTime: endTime || '17:00',
      minInterval: parseInt(minInterval) || 15,
      maxInterval: parseInt(maxInterval) || 25
    };

    const { scheduledTimes, warning, error } = calculateScheduleTimes(draftedEmails.length, settings);

    // Return error if time window is insufficient
    if (error) {
      return res.status(400).json({ error });
    }

    // Build preview data
    const preview = draftedEmails.map((email, index) => ({
      company: email.company,
      ceoEmail: email.ceoEmail,
      subject: parseEmailDraft(email.email).subject,
      scheduledTime: scheduledTimes[index] ? scheduledTimes[index].toISOString() : null,
      formattedTime: scheduledTimes[index] ? formatTimeForTimezone(scheduledTimes[index], tz) : 'Not scheduled'
    }));

    res.json({
      emails: preview,
      warning,
      settings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Start scheduled sending (supports adding to existing schedule)
app.post('/api/schedule/start', async (req, res) => {
  const { timezone, scheduleDate, startTime, endTime, minInterval, maxInterval, filterEmail } = req.body;

  if (scheduleJob.running) {
    return res.status(400).json({ error: 'Schedule job already running. Wait for current batch to finish scheduling.' });
  }

  // Check if we have existing pending emails (adding to schedule)
  const existingPending = scheduleJob.scheduledEmails.filter(e => e.status === 'pending');
  const isAddingToExisting = existingPending.length > 0;

  if (isAddingToExisting) {
    // Adding to existing schedule - preserve pending emails but update settings
    scheduleJob.running = true;
    scheduleJob.settings = {
      timezone: TIMEZONE_MAP[timezone] || timezone || 'America/New_York',
      scheduleDate: scheduleDate || new Date().toISOString().slice(0, 10),
      startTime: startTime || '09:00',
      endTime: endTime || '17:00',
      minInterval: parseInt(minInterval) || 15,
      maxInterval: parseInt(maxInterval) || 25,
      filterEmail: filterEmail || ''
    };
    scheduleLog(`--- Adding more emails to existing schedule (${existingPending.length} already pending) ---`);
    res.json({ message: 'Adding to existing schedule', existingPending: existingPending.length });
  } else {
    // Fresh start - reset everything
    scheduleJob = {
      running: true,
      progress: 0,
      total: 0,
      logs: [],
      results: { sent: 0, failed: 0, pending: 0 },
      scheduledEmails: [],
      settings: {
        timezone: TIMEZONE_MAP[timezone] || timezone || 'America/New_York',
        scheduleDate: scheduleDate || new Date().toISOString().slice(0, 10),
        startTime: startTime || '09:00',
        endTime: endTime || '17:00',
        minInterval: parseInt(minInterval) || 15,
        maxInterval: parseInt(maxInterval) || 25,
        filterEmail: filterEmail || ''
      }
    };
    res.json({ message: 'Schedule job started' });
  }

  // Process in background
  scheduleEmails().catch(err => {
    scheduleLog(`Fatal error: ${err.message}`);
    scheduleJob.running = false;
  });
});

// API: Stop scheduled sending
app.post('/api/schedule/stop', async (req, res) => {
  const hasPending = scheduleJob.scheduledEmails.some(e => e.status === 'pending');

  if (scheduleJob.running || hasPending) {
    scheduleJob.running = false;
    scheduleLog('Schedule job stopped by user');

    // Cancel all pending timeouts and update sheet status
    let cancelledCount = 0;
    const updatePromises = [];
    for (const scheduled of scheduleJob.scheduledEmails) {
      if (scheduled.timeoutId && scheduled.status === 'pending') {
        clearTimeout(scheduled.timeoutId);
        scheduled.status = 'cancelled';
        cancelledCount++;
        // Update sheet status back to "Drafted" so it can be re-scheduled
        updatePromises.push(
          updateStatus(scheduled.company, 'Drafted').catch(err => {
            console.error(`Failed to update status for ${scheduled.company}:`, err.message);
          })
        );
      }
    }

    // Wait for all sheet updates
    await Promise.all(updatePromises);

    // Reset pending count and clear scheduled emails
    scheduleJob.results.pending = 0;
    scheduleJob.scheduledEmails = [];

    res.json({ message: `Schedule job stopped. ${cancelledCount} email(s) cancelled and reset to Drafted.` });
  } else {
    res.json({ message: 'No scheduled emails to stop' });
  }
});

// API: Reset all "Scheduled" emails in sheet back to "Drafted"
app.post('/api/schedule/reset-all', async (req, res) => {
  try {
    const allEmails = await getAllEmails();
    const scheduledEmails = allEmails.filter(e =>
      (e.status || '').toLowerCase().trim() === 'scheduled'
    );

    if (scheduledEmails.length === 0) {
      return res.json({ message: 'No scheduled emails found to reset', count: 0 });
    }

    // Reset all to Drafted
    let resetCount = 0;
    for (const email of scheduledEmails) {
      await updateStatus(email.company, 'Drafted');
      resetCount++;
    }

    // Clear in-memory scheduled emails
    scheduleJob.scheduledEmails = [];
    scheduleJob.results.pending = 0;
    scheduleJob.running = false;

    res.json({ message: `Reset ${resetCount} email(s) from Scheduled to Drafted`, count: resetCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Cancel a specific scheduled email
app.post('/api/schedule/cancel', async (req, res) => {
  const { company } = req.body;

  if (!company) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  try {
    // Find the scheduled email index
    const index = scheduleJob.scheduledEmails.findIndex(e => e.company === company);

    if (index === -1) {
      // Not in memory, but might be in sheet - just update sheet
      await updateStatus(company, 'Drafted');
      await clearScheduledTime(company);
      scheduleLog(`Cancelled (sheet only): ${company}`);
      return res.json({ message: `Cancelled scheduling for ${company}` });
    }

    const scheduled = scheduleJob.scheduledEmails[index];

    if (scheduled.status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel email with status: ${scheduled.status}` });
    }

    // Clear the timeout
    if (scheduled.timeoutId) {
      clearTimeout(scheduled.timeoutId);
    }

    // REMOVE from array entirely (not just mark as cancelled)
    scheduleJob.scheduledEmails.splice(index, 1);
    scheduleJob.results.pending--;

    // Update sheet: revert status to "Drafted" and clear scheduled time
    await updateStatus(company, 'Drafted');
    await clearScheduledTime(company);

    scheduleLog(`Cancelled: ${company}`);
    res.json({ message: `Cancelled scheduling for ${company}` });
  } catch (error) {
    console.error(`[CANCEL] Error cancelling ${company}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// API: Reschedule a single email
app.post('/api/schedule/reschedule', async (req, res) => {
  const { company, newTime } = req.body;

  if (!company || !newTime) {
    return res.status(400).json({ error: 'Company and newTime are required' });
  }

  try {
    const timezone = scheduleJob.settings.timezone || 'America/New_York';
    const newScheduledTime = new Date(newTime);

    if (isNaN(newScheduledTime.getTime())) {
      return res.status(400).json({ error: 'Invalid time format' });
    }

    // Find the scheduled email
    const index = scheduleJob.scheduledEmails.findIndex(e => e.company === company);

    if (index !== -1) {
      const scheduled = scheduleJob.scheduledEmails[index];

      // Clear old timeout
      if (scheduled.timeoutId) {
        clearTimeout(scheduled.timeoutId);
      }

      // Update with new time
      scheduled.scheduledTime = newScheduledTime.toISOString();

      // Calculate new delay
      const now = new Date();
      const delay = newScheduledTime - now;

      if (delay > 0) {
        scheduled.timeoutId = setTimeout(() => {
          scheduleLog(`[TIMEOUT EXECUTING] ${company}`);
          sendScheduledEmail(scheduled);
        }, delay);
        scheduleLog(`Rescheduled: ${company} for ${formatTimeForTimezone(newScheduledTime, timezone)} (in ${Math.round(delay / 60000)} min)`);
      } else {
        scheduleLog(`WARNING: New time already passed for ${company}. Will send immediately.`);
        sendScheduledEmail(scheduled);
      }
    }

    // Update sheet
    await updateScheduledTime(company, newScheduledTime.toISOString(), timezone);

    res.json({ message: `Rescheduled ${company} for ${newScheduledTime.toISOString()}` });
  } catch (error) {
    console.error(`[RESCHEDULE] Error:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Calculate required end time given start time and required minutes
 */
function calculateRequiredEndTime(startTime, requiredMinutes) {
  const [startHour, startMin] = startTime.split(':').map(Number);
  const totalMinutes = startHour * 60 + startMin + requiredMinutes;
  const endHour = Math.floor(totalMinutes / 60);
  const endMin = totalMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
}

/**
 * Calculate schedule times for emails within the given time range
 */
function calculateScheduleTimes(emailCount, settings) {
  const { timezone, scheduleDate, startTime, endTime, minInterval, maxInterval } = settings;
  const now = new Date();

  // Use provided date or today
  const targetDate = scheduleDate || new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  // First, check if time window is sufficient BEFORE any other processing
  // Minimum time required = (emailCount - 1) * minInterval (first email sends at start, rest need intervals)
  const minTimeRequiredMinutes = (emailCount - 1) * minInterval;

  // Calculate available time window from the raw start/end times
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  const availableMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);

  // Check if time window is sufficient
  if (emailCount > 1 && availableMinutes < minTimeRequiredMinutes) {
    const requiredEndTime = calculateRequiredEndTime(startTime, minTimeRequiredMinutes);
    return {
      scheduledTimes: [],
      warning: null,
      error: `Time window too small. You have ${emailCount} emails requiring at least ${minTimeRequiredMinutes} minutes (using ${minInterval}-minute intervals). Your current window is only ${availableMinutes} minutes. Please set end time to ${requiredEndTime} or later.`
    };
  }

  // Create date strings and parse them in the target timezone
  const startStr = `${targetDate} ${startTime}`;
  const endStr = `${targetDate} ${endTime}`;

  // Parse the dates - these are in local time
  let startDate = parseDateInTimezone(startStr, timezone);
  let endDate = parseDateInTimezone(endStr, timezone);

  // Minimum delay: always schedule at least 2 minutes from now (for testing safety)
  const MIN_DELAY_MS = 2 * 60 * 1000; // 2 minutes
  const minimumScheduleTime = new Date(now.getTime() + MIN_DELAY_MS);

  // Start from whichever is later: configured start time OR minimum delay time
  let currentTime;
  if (startDate < minimumScheduleTime) {
    currentTime = minimumScheduleTime;
    console.log(`[SCHEDULE] Adjusted start to minimum delay: ${minimumScheduleTime.toISOString()}`);
  } else {
    currentTime = startDate;
  }

  const scheduledTimes = [];
  let warning = null;

  for (let i = 0; i < emailCount; i++) {
    // Check if we've passed the end time
    if (currentTime >= endDate) {
      warning = `Only ${scheduledTimes.length} of ${emailCount} emails fit in the time range. ${emailCount - scheduledTimes.length} emails will not be scheduled.`;
      break;
    }

    scheduledTimes.push(new Date(currentTime));

    // Add random interval for next email
    const interval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
    currentTime = new Date(currentTime.getTime() + interval * 60000);
  }

  return { scheduledTimes, warning, error: null };
}

/**
 * Parse a date string (YYYY-MM-DD HH:MM) in a specific timezone and return UTC Date
 */
function parseDateInTimezone(dateStr, timezone) {
  // dateStr format: "2026-01-25 17:00"
  const [datePart, timePart] = dateStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  // Create a reference date to get the timezone offset
  // We use the target date at noon to avoid DST edge cases
  const refDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Get the timezone offset by comparing UTC to the timezone representation
  const utcString = refDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzString = refDate.toLocaleString('en-US', { timeZone: timezone });

  const utcParsed = new Date(utcString);
  const tzParsed = new Date(tzString);

  // Offset in milliseconds (positive means timezone is behind UTC)
  const offsetMs = utcParsed.getTime() - tzParsed.getTime();

  // Create UTC date for the desired time, then adjust by offset
  // If user wants 17:00 ET, and ET is UTC-5, we need 22:00 UTC
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return new Date(utcDate.getTime() + offsetMs);
}

/**
 * Format a date for display in a timezone
 */
function formatTimeForTimezone(date, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

/**
 * Main scheduling logic - schedules all drafted emails
 */
async function scheduleEmails() {
  scheduleLog('Starting scheduled sending...');

  try {
    // Get all drafted emails
    const allEmails = await getAllEmails();
    // Filter by status - case-insensitive and trim whitespace
    let draftedEmails = allEmails.filter(e => {
      const status = (e.status || '').toLowerCase().trim();
      return status === 'drafted';
    });

    // Filter by specific email if provided (for testing)
    if (scheduleJob.settings.filterEmail) {
      const filter = scheduleJob.settings.filterEmail.toLowerCase();
      draftedEmails = draftedEmails.filter(e =>
        e.ceoEmail.toLowerCase().includes(filter)
      );
      scheduleLog(`Filtering by email: ${scheduleJob.settings.filterEmail}`);
    }

    if (draftedEmails.length === 0) {
      scheduleLog('No drafted emails found (check filter if set)');
      scheduleJob.running = false;
      return;
    }

    scheduleLog(`Found ${draftedEmails.length} drafted email(s) to schedule`);
    // Add to existing total (supports adding to existing schedule)
    scheduleJob.total += draftedEmails.length;

    // Calculate schedule times
    const { scheduledTimes, warning } = calculateScheduleTimes(draftedEmails.length, scheduleJob.settings);

    if (warning) {
      scheduleLog(`Warning: ${warning}`);
    }

    // Schedule each email
    for (let i = 0; i < scheduledTimes.length; i++) {
      const email = draftedEmails[i];
      const scheduledTime = scheduledTimes[i];
      const { subject } = parseEmailDraft(email.email);

      const scheduledEmail = {
        company: email.company,
        ceoEmail: email.ceoEmail,
        subject: subject,
        scheduledTime: scheduledTime,
        status: 'pending',
        timeoutId: null
      };

      // Calculate delay in milliseconds
      const delay = scheduledTime.getTime() - Date.now();
      const delayMinutes = Math.round(delay / 60000 * 10) / 10; // Round to 1 decimal

      if (delay > 0) {
        // Update sheet with scheduled time and status
        await updateStatus(email.company, 'Scheduled');
        await updateScheduledTime(email.company, scheduledTime, scheduleJob.settings.timezone);

        // Set timeout to send at the scheduled time
        scheduleLog(`Setting timeout for ${email.company}: ${delayMinutes} minutes (${delay}ms)`);
        scheduledEmail.timeoutId = setTimeout(() => {
          scheduleLog(`[TIMEOUT EXECUTING] ${email.company}`);
          sendScheduledEmail(scheduledEmail);
        }, delay);

        scheduleJob.results.pending++;
        scheduleLog(`Scheduled: ${email.company} for ${formatTimeForTimezone(scheduledTime, scheduleJob.settings.timezone)} (in ${delayMinutes} min)`);
      } else {
        // Time already passed - this shouldn't happen with minimum delay, but handle it
        scheduleLog(`WARNING: Time already passed for ${email.company} (delay: ${delay}ms). Sending immediately.`);
        await updateStatus(email.company, 'Scheduled');
        await updateScheduledTime(email.company, scheduledTime, scheduleJob.settings.timezone);
        sendScheduledEmail(scheduledEmail);
      }

      scheduleJob.scheduledEmails.push(scheduledEmail);
    }

    scheduleLog(`Scheduling complete. ${scheduleJob.results.pending} emails pending.`);
    // Set running to false - batch processing is done, now just waiting for timeouts
    scheduleJob.running = false;
  } catch (error) {
    scheduleLog(`Error: ${error.message}`);
    scheduleJob.running = false;
  }
}

/**
 * Send a scheduled email
 * STRICT DUPLICATE PREVENTION: Multiple checks before sending
 */
async function sendScheduledEmail(scheduledEmail) {
  const timestamp = new Date().toISOString();
  const emailLower = scheduledEmail.ceoEmail.toLowerCase();
  scheduleLog(`[${timestamp}] TIMEOUT FIRED for: ${scheduledEmail.company}`);

  // CHECK 1: Email must still be pending (not cancelled)
  if (scheduledEmail.status !== 'pending') {
    scheduleLog(`BLOCKED (status: ${scheduledEmail.status}): ${scheduledEmail.company}`);
    return;
  }

  // CHECK 2: STRICT DUPLICATE PREVENTION - Check if email was already sent
  if (sentEmailAddresses.has(emailLower)) {
    const prev = sentEmailAddresses.get(emailLower);
    scheduleLog(`BLOCKED (DUPLICATE): ${scheduledEmail.company} - Already sent to ${scheduledEmail.ceoEmail} for company "${prev.company}" at ${prev.sentAt}`);
    scheduledEmail.status = 'blocked-duplicate';
    scheduleJob.results.pending--;
    return;
  }

  // CHECK 3: Verify sheet status is still "Scheduled" (prevents race conditions)
  try {
    const sheetEmails = await getAllEmails();
    const sheetEntry = sheetEmails.find(e => e.company === scheduledEmail.company);
    if (!sheetEntry) {
      scheduleLog(`BLOCKED (not in sheet): ${scheduledEmail.company}`);
      scheduledEmail.status = 'blocked-not-found';
      scheduleJob.results.pending--;
      return;
    }
    const sheetStatus = (sheetEntry.status || '').toLowerCase().trim();
    if (sheetStatus !== 'scheduled') {
      scheduleLog(`BLOCKED (status changed): ${scheduledEmail.company} - Sheet status is "${sheetEntry.status}", expected "Scheduled"`);
      scheduledEmail.status = 'blocked-status-changed';
      scheduleJob.results.pending--;
      return;
    }
  } catch (error) {
    scheduleLog(`BLOCKED (sheet check failed): ${scheduledEmail.company} - ${error.message}`);
    scheduledEmail.status = 'blocked-error';
    scheduleJob.results.pending--;
    return;
  }

  // CHECK 4: Double-check the email wasn't sent while we were checking
  if (sentEmailAddresses.has(emailLower)) {
    scheduleLog(`BLOCKED (race condition): ${scheduledEmail.company}`);
    scheduledEmail.status = 'blocked-race';
    scheduleJob.results.pending--;
    return;
  }

  // MARK AS SENDING (before actual send to prevent race conditions)
  sentEmailAddresses.set(emailLower, {
    company: scheduledEmail.company,
    sentAt: new Date().toISOString()
  });

  scheduleLog(`Sending: ${scheduledEmail.company}...`);
  scheduleLog(`  Looking for draft: to="${scheduledEmail.ceoEmail}", subject="${scheduledEmail.subject.substring(0, 30)}..."`);

  try {
    // Find the draft by recipient and subject
    const draft = await findDraftByRecipientAndSubject(
      scheduledEmail.ceoEmail,
      scheduledEmail.subject
    );

    if (!draft) {
      // Remove from sent tracking since we didn't actually send
      sentEmailAddresses.delete(emailLower);
      scheduleLog(`  ERROR: Draft not found!`);
      throw new Error(`Draft not found for ${scheduledEmail.ceoEmail} with subject "${scheduledEmail.subject.substring(0, 30)}..."`);
    }

    scheduleLog(`  Found draft ID: ${draft.id}`);

    // Send the draft
    const sendResult = await sendDraft(draft.id);
    scheduleLog(`  Gmail API response: messageId=${sendResult.id || 'N/A'}`);

    // Update status
    scheduledEmail.status = 'sent';
    scheduleJob.results.sent++;
    scheduleJob.results.pending--;
    scheduleJob.progress++;

    // Update sheet status
    await updateStatus(scheduledEmail.company, 'Sent');

    scheduleLog(`SUCCESS: ${scheduledEmail.company} - Email sent!`);
  } catch (error) {
    // Remove from sent tracking since send failed - allow retry
    sentEmailAddresses.delete(emailLower);

    scheduleLog(`  EXCEPTION: ${error.message}`);
    console.error(`[SCHEDULE ERROR] ${error.stack}`);

    scheduledEmail.status = 'failed';
    scheduledEmail.error = error.message;
    scheduleJob.results.failed++;
    scheduleJob.results.pending--;
    scheduleJob.progress++;

    // Update sheet status
    await updateStatus(scheduledEmail.company, `Failed: ${error.message.substring(0, 50)}`);

    scheduleLog(`FAILED: ${scheduledEmail.company} - ${error.message}`);
  }

  // Check if all emails have been processed
  if (scheduleJob.results.sent + scheduleJob.results.failed >= scheduleJob.total) {
    scheduleJob.running = false;
    scheduleLog(`Finished! Sent: ${scheduleJob.results.sent}, Failed: ${scheduleJob.results.failed}`);
  }
}

// Parse email draft to extract subject and body
function parseEmailDraft(emailText) {
  if (!emailText || typeof emailText !== 'string') {
    return { subject: '', body: '' };
  }

  // Handle JSON A/B variant format: {"company":"...","ceoName":"...","variants":{"A":{"strategy":"...","email":"Subject: ...\n\n..."},...}}
  let text = emailText.trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.variants) {
        // Use variant A by default
        const variant = parsed.variants.A || parsed.variants.B || parsed.variants.C;
        text = variant?.email || '';
      } else if (parsed.email) {
        text = parsed.email;
      }
    } catch (e) {
      // Not valid JSON, treat as plain text
    }
  }

  if (!text) return { subject: '', body: '' };

  const lines = text.trim().split('\n');
  const firstLine = lines[0]?.trim() || '';

  if (firstLine.toLowerCase().startsWith('subject:')) {
    const subject = firstLine.replace(/^subject:\s*/i, '').trim();
    const bodyLines = lines.slice(1);
    const firstNonEmptyIndex = bodyLines.findIndex(l => l.trim() !== '');
    const body = bodyLines.slice(firstNonEmptyIndex).join('\n').trim();
    return { subject, body };
  }

  return {
    subject: firstLine.substring(0, 100),
    body: text.trim()
  };
}

// Process drafts - create Gmail drafts with signature
async function processDrafts(mode) {
  draftLog('Connecting to Gmail...');

  try {
    const gmailEmail = await getMyEmail();
    draftJob.gmailConnected = true;
    draftJob.gmailEmail = gmailEmail;
    draftLog(`Connected as: ${gmailEmail}`);
  } catch (error) {
    draftLog(`Gmail connection failed: ${error.message}`);
    draftJob.running = false;
    return;
  }

  draftLog('Fetching emails from sheet...');
  let emails = [];

  try {
    const allEmails = await getAllEmails();

    if (mode === 'ready') {
      emails = allEmails.filter(e =>
        e.ceoEmail && e.email &&
        (e.status === 'Ready for review' || e.status === 'Edited')
      );
    } else if (mode === 'all') {
      emails = allEmails.filter(e =>
        e.ceoEmail && e.email && e.status !== 'Drafted'
      );
    } else if (mode === 'force') {
      emails = allEmails.filter(e => e.ceoEmail && e.email);
    }

    draftLog(`Found ${emails.length} email(s) to draft`);
  } catch (error) {
    draftLog(`Error fetching emails: ${error.message}`);
    draftJob.running = false;
    return;
  }

  if (emails.length === 0) {
    draftLog('No emails to draft');
    draftJob.running = false;
    return;
  }

  draftJob.total = emails.length;
  const processedEmails = new Set();

  for (let i = 0; i < emails.length; i++) {
    if (!draftJob.running) {
      draftLog('Draft job cancelled');
      break;
    }

    const email = emails[i];
    draftJob.progress = i + 1;
    draftJob.current = email.company;

    const emailKey = email.ceoEmail.toLowerCase();

    // Skip duplicates
    if (processedEmails.has(emailKey)) {
      draftLog(`Skipped duplicate: ${email.company} (${email.ceoEmail})`);
      draftJob.results.skipped++;
      continue;
    }

    const { subject, body } = parseEmailDraft(email.email);

    if (!subject && !body) {
      draftLog(`Skipped empty draft: ${email.company}`);
      draftJob.results.skipped++;
      continue;
    }

    try {
      draftLog(`Creating draft: ${email.company} → ${email.ceoEmail}`);

      // Create Gmail draft with signature and proper HTML formatting
      let sendFrom = '';
      try { sendFrom = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')).sendFromEmail || ''; } catch(e) {}
      await createDraftWithSignature(email.ceoEmail, subject, body, sendFrom || undefined);

      // Update status
      await updateStatus(email.company, 'Drafted');

      draftLog(`✓ Draft created: ${email.company}`);
      processedEmails.add(emailKey);
      draftJob.results.drafted++;

      // Small delay between API calls
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      draftLog(`✗ Failed: ${email.company} - ${error.message}`);
      draftJob.results.failed++;
    }
  }

  draftJob.running = false;
  draftJob.current = '';
  draftLog(`Finished! Drafted: ${draftJob.results.drafted}, Skipped: ${draftJob.results.skipped}, Failed: ${draftJob.results.failed}`);
}

/**
 * Update a lead's status in the currentJob.leads array
 */
function setLeadStatus(rowNumber, status, detail = '') {
  const lead = currentJob.leads.find(l => l.rowNumber === rowNumber);
  if (lead) {
    lead.status = status;
    lead.detail = detail;
  }
}

/**
 * Core processing logic for a single company
 */
async function processSingleCompany(company) {
  setLeadStatus(company.rowNumber, 'processing', 'Searching Trustpilot...');
  log(`  Searching Trustpilot...`);
  const trustpilot = await findTrustpilotPage(company.website, company.company);

  if (!trustpilot.found) {
    log(`  No Trustpilot page found`);
    await writeDraftToLead(company.rowNumber, { trustpilotUrl: '', emailDraft: '', draftId: '' });
    await markAsProcessed(company.rowNumber, 'Skipped - No Trustpilot');
    setLeadStatus(company.rowNumber, 'skipped', 'No Trustpilot page');
    currentJob.results.skipped++;
    return;
  }

  log(`  Found: ${trustpilot.url}${trustpilot.rating ? ` (Rating: ${trustpilot.rating})` : ''}`);
  setLeadStatus(company.rowNumber, 'processing', 'Scraping reviews...');

  log(`  Scraping reviews...`);
  const reviews = await scrapeReviews(trustpilot.url, [1, 2], 20);
  log(`  Found ${reviews.length} negative reviews`);

  if (reviews.length === 0) {
    await writeDraftToLead(company.rowNumber, { trustpilotUrl: trustpilot.url, emailDraft: '', draftId: '' });
    await markAsProcessed(company.rowNumber, 'Skipped - No Reviews');
    setLeadStatus(company.rowNumber, 'skipped', 'No negative reviews');
    currentJob.results.skipped++;
    return;
  }

  // Generate email
  setLeadStatus(company.rowNumber, 'processing', 'Generating email...');
  log(`  Generating email...`);
  const emailResult = await generateEmail({
    ceoName: company.ceoName,
    reviews,
    company: company.company
  });

  // Extract variant A for the draft
  const variantA = emailResult?.variants?.A?.email || (typeof emailResult === 'string' ? emailResult : '');
  const { subject, body } = parseEmailDraft(typeof emailResult === 'object' ? JSON.stringify(emailResult) : variantA);

  if (!subject || !body || !company.email) {
    log(`  No email address or empty email generated — skipping draft`);
    await writeDraftToLead(company.rowNumber, {
      trustpilotUrl: trustpilot.url,
      emailDraft: typeof emailResult === 'object' ? JSON.stringify(emailResult) : variantA,
      draftId: ''
    });
    await markAsProcessed(company.rowNumber, 'Generated - No Draft');
    setLeadStatus(company.rowNumber, 'done', 'Email generated (no draft - missing email)');
    currentJob.results.successful++;
    return;
  }

  // Auto-create Gmail draft
  setLeadStatus(company.rowNumber, 'processing', 'Creating Gmail draft...');
  log(`  Creating Gmail draft...`);
  let draftId = '';
  try {
    let sendFrom = '';
    try { sendFrom = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')).sendFromEmail || ''; } catch(e) {}
    const draft = await createDraftWithSignature(company.email, subject, body, sendFrom || undefined);
    draftId = draft.id || '';
    log(`  Draft created: ${draftId}`);
  } catch (err) {
    log(`  Draft creation failed: ${err.message}`);
  }

  // Write everything to Sheet1
  await writeDraftToLead(company.rowNumber, {
    trustpilotUrl: trustpilot.url,
    emailDraft: typeof emailResult === 'object' ? JSON.stringify(emailResult) : variantA,
    draftId
  });
  await markAsProcessed(company.rowNumber, draftId ? 'Drafted' : 'Generated');

  log(`  Done`);
  setLeadStatus(company.rowNumber, 'done', draftId ? 'Drafted' : 'Email generated');
  currentJob.results.successful++;
}

/**
 * Process companies from a contiguous range (legacy support)
 */
async function processCompanies(startRow, limit) {
  log(`Starting processing: rows ${startRow} to ${startRow + limit - 1}`);

  let companies;
  try {
    companies = await readCompanies(startRow, limit);
    log(`Found ${companies.length} companies`);
  } catch (error) {
    log(`Error reading sheet: ${error.message}`);
    currentJob.running = false;
    return;
  }

  currentJob.total = companies.length;
  currentJob.leads = companies.map(c => ({
    rowNumber: c.rowNumber,
    company: c.company,
    email: c.email,
    website: c.website,
    status: 'queued',
    detail: ''
  }));

  for (let i = 0; i < companies.length; i++) {
    if (!currentJob.running) { log('Job cancelled'); break; }

    const company = companies[i];
    currentJob.progress = i + 1;
    currentJob.current = company.company;
    log(`Processing ${i + 1}/${companies.length}: ${company.company}`);

    try {
      await processSingleCompany(company);
    } catch (error) {
      log(`  Error: ${error.message}`);
      setLeadStatus(company.rowNumber, 'failed', error.message);
      currentJob.results.failed++;
    }

    if (i < companies.length - 1 && currentJob.running) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  currentJob.running = false;
  currentJob.current = '';
  log(`Finished! Success: ${currentJob.results.successful}, Skipped: ${currentJob.results.skipped}, Failed: ${currentJob.results.failed}`);
}

/**
 * Process specific selected rows (from the UI leads table)
 */
async function processSelectedRows(rowNumbers) {
  log(`Starting processing: ${rowNumbers.length} selected lead(s)`);

  // Read each row individually
  let companies = [];
  for (const row of rowNumbers) {
    try {
      const rows = await readCompanies(row, 1);
      if (rows.length > 0) companies.push(rows[0]);
    } catch (e) {
      log(`Error reading row ${row}: ${e.message}`);
    }
  }

  if (companies.length === 0) {
    log('No valid companies found in selected rows');
    currentJob.running = false;
    return;
  }

  log(`Found ${companies.length} companies`);
  currentJob.total = companies.length;
  currentJob.leads = companies.map(c => ({
    rowNumber: c.rowNumber,
    company: c.company,
    email: c.email,
    website: c.website,
    status: 'queued',
    detail: ''
  }));

  for (let i = 0; i < companies.length; i++) {
    if (!currentJob.running) { log('Job cancelled'); break; }

    const company = companies[i];
    currentJob.progress = i + 1;
    currentJob.current = company.company;
    log(`Processing ${i + 1}/${companies.length}: ${company.company}`);

    try {
      await processSingleCompany(company);
    } catch (error) {
      log(`  Error: ${error.message}`);
      setLeadStatus(company.rowNumber, 'failed', error.message);
      currentJob.results.failed++;
    }

    if (i < companies.length - 1 && currentJob.running) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  currentJob.running = false;
  currentJob.current = '';
  log(`Finished! Success: ${currentJob.results.successful}, Skipped: ${currentJob.results.skipped}, Failed: ${currentJob.results.failed}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          TRUSTPILOT OUTREACH AUTOMATION                       ║
║          Web Interface Running                                ║
╚═══════════════════════════════════════════════════════════════╝

Open in browser: http://localhost:${PORT}
  `);

  // Recover any scheduled emails from before server restart
  try {
    await recoverScheduledEmails();
  } catch (error) {
    console.error('[STARTUP] Failed to recover scheduled emails:', error.message);
  }
});

#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Diagnostic script to find and retry failed processing attempts
 */

async function getSheetsClient() {
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
  const credentials = JSON.parse(readFileSync(path.resolve(credentialsPath), 'utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

async function findUnprocessedCompanies() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  console.log('🔍 SCANNING FOR UNPROCESSED COMPANIES\n');
  console.log('Checking Sheet1 for rows where Column A is empty...\n');

  // Read Sheet1 data (rows 2-200)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A2:Q200'
  });

  const rows = response.data.values || [];
  const unprocessed = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const channel = (row[0] || '').toString().trim().toLowerCase();
    const company = (row[5] || '').trim();
    const website = (row[13] || '').trim();

    // Empty channel means not processed
    if (!channel && company) {
      unprocessed.push({
        rowNumber,
        company,
        website,
        firstName: row[2] || '',
        lastName: row[3] || ''
      });
    }
  });

  return unprocessed;
}

async function checkEmailsTab() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  console.log('📊 CHECKING EMAILS TAB\n');

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Emails!A2:G'
    });

    const rows = response.data.values || [];

    const stats = {
      total: rows.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      ready: 0
    };

    const failed = [];

    rows.forEach((row, index) => {
      const status = (row[6] || '').toLowerCase();

      if (status.includes('sent')) stats.sent++;
      else if (status.includes('skipped')) stats.skipped++;
      else if (status.includes('failed') || status.includes('error')) {
        stats.failed++;
        failed.push({
          rowNumber: index + 2,
          company: row[0],
          status: row[6],
          error: row[5] // Email column might have error message
        });
      }
      else if (status.includes('ready')) stats.ready++;
    });

    console.log(`Total entries: ${stats.total}`);
    console.log(`✓ Sent: ${stats.sent}`);
    console.log(`⊘ Skipped: ${stats.skipped}`);
    console.log(`✗ Failed: ${stats.failed}`);
    console.log(`⏳ Ready for review: ${stats.ready}`);
    console.log('');

    if (failed.length > 0) {
      console.log('FAILED ENTRIES:');
      failed.forEach(f => {
        console.log(`  Row ${f.rowNumber}: ${f.company}`);
        console.log(`    Status: ${f.status}`);
        console.log('');
      });
    }

    return { stats, failed };
  } catch (error) {
    console.log('⚠️  No Emails tab found or error reading it');
    return { stats: { total: 0, sent: 0, skipped: 0, failed: 0, ready: 0 }, failed: [] };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('         OUTREACH AUTOMATION - DIAGNOSTIC REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check Emails tab
  const emailsData = await checkEmailsTab();

  console.log('');

  // Find unprocessed companies
  const unprocessed = await findUnprocessedCompanies();

  console.log(`Found ${unprocessed.length} unprocessed companies\n`);

  if (unprocessed.length > 0) {
    console.log('NEXT COMPANIES TO PROCESS:');
    unprocessed.slice(0, 10).forEach(c => {
      console.log(`  Row ${c.rowNumber}: ${c.company} (${c.website})`);
    });

    if (unprocessed.length > 10) {
      console.log(`  ... and ${unprocessed.length - 10} more`);
    }

    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    RECOMMENDED ACTIONS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const firstRow = unprocessed[0].rowNumber;

    console.log('To process the next batch (with smaller batches to avoid failures):\n');
    console.log(`  # Process 5 companies at a time (safer):
  node src/index.js --start=${firstRow} --limit=5

  # Process 10 companies at a time:
  node src/index.js --start=${firstRow} --limit=10

  # Process all remaining:
  node src/index.js --start=${firstRow}
`);

    console.log('💡 TIP: Process in smaller batches (5-10) to avoid rate limits and timeouts\n');
  } else {
    console.log('✅ All companies have been processed!\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

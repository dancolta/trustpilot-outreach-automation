#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import path from 'path';
import { scrapeReviews } from './trustpilot.js';
import { generateEmail, analyzeReviewsWithAI } from './emailGen.js';

const credentials = JSON.parse(readFileSync(path.resolve('./credentials.json'), 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

async function regenerateEmails() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          REGENERATING EMAILS WITH NEW FORMAT                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Get emails tab data
  const emailsData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'emails'!A:G",
  });

  const rows = emailsData.data.values || [];
  if (rows.length <= 1) {
    console.log('No emails to regenerate.');
    return;
  }

  // Get Sheet1 data for CEO names/emails
  const sheet1Data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A:Q",
  });
  const sheet1Rows = sheet1Data.data.values || [];

  // Create lookup by company name
  const companyLookup = {};
  sheet1Rows.slice(1).forEach(row => {
    const company = row[5]?.trim();
    if (company) {
      companyLookup[company] = {
        ceoName: `${row[2] || ''} ${row[3] || ''}`.trim(),
        email: row[6]?.trim() || '',
        website: row[13]?.trim() || ''
      };
    }
  });

  console.log(`Found ${rows.length - 1} emails to regenerate.\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const company = row[0];
    const ceoName = row[1];
    const trustpilotUrl = row[3];
    const status = row[6];

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[${i}/${rows.length - 1}] ${company}`);

    // Skip if no Trustpilot URL or already skipped/failed
    if (!trustpilotUrl || trustpilotUrl === '' || status?.includes('Skipped') || status?.includes('Failed')) {
      console.log('  Skipping - no Trustpilot URL or previously skipped/failed');
      skipped++;
      continue;
    }

    try {
      // Get company info from lookup
      const info = companyLookup[company] || { ceoName, email: row[2], website: '' };

      // Scrape fresh reviews
      console.log('  Scraping reviews...');
      const reviews = await scrapeReviews(trustpilotUrl, [1, 2], 20);
      console.log(`  Found ${reviews.length} reviews`);

      if (reviews.length === 0) {
        console.log('  No reviews - skipping');
        skipped++;
        continue;
      }

      // Analyze pain points
      console.log('  Analyzing pain points...');
      const painPoints = await analyzeReviewsWithAI(reviews, company);

      // Generate new email (variant A — regenerate doesn't need A/B split)
      console.log('  Generating high-converting email...');
      const newEmail = await generateEmail({
        company,
        ceoName: info.ceoName || ceoName,
        reviews,
        variant: 'A'
      });

      // Update the row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'emails'!E${i + 1}:F${i + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[painPoints, newEmail]]
        }
      });

      console.log('  ✓ Email regenerated');
      success++;

      // Delay between companies
      if (i < rows.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }

    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        SUMMARY                                 ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Regenerated:  ${success}`);
  console.log(`  Skipped:      ${skipped}`);
  console.log(`  Failed:       ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

regenerateEmails().catch(console.error);

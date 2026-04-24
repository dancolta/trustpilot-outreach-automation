#!/usr/bin/env node

import 'dotenv/config';
import { readCompanies, writeOutreach, markAsProcessed } from './sheets.js';
import { findAndScrape } from './trustpilot.js';
import { generateEmail, analyzeReviewsWithAI } from './emailGen.js';

const BANNER = `
╔═══════════════════════════════════════════════════════════════╗
║          TRUSTPILOT OUTREACH AUTOMATION                       ║
║          Lead Generation via Review Analysis                  ║
╚═══════════════════════════════════════════════════════════════╝
`;

/**
 * Process a single company through the full pipeline
 */
async function processCompany(company) {
  console.log(`\n▶ Processing: ${company.company} (Row ${company.rowNumber})`);
  console.log(`  CEO: ${company.ceoName}`);
  console.log(`  Website: ${company.website}`);

  try {
    // Step 1+2: Find Trustpilot page and scrape reviews in a single browser session
    console.log('  [1/5] Searching Trustpilot and scraping reviews...');
    const { trustpilot, reviews } = await findAndScrape(company.website, company.company, [1, 2], 20);

    if (!trustpilot.found) {
      console.log('  ✗ No Trustpilot page found');
      await writeOutreach({
        ceoName: company.ceoName,
        ceoEmail: company.email,
        company: company.company,
        trustpilotUrl: '',
        painPoints: 'No Trustpilot page found',
        generatedEmail: 'N/A - Company not on Trustpilot',
        status: 'Skipped - No Trustpilot'
      });
      return { success: true, skipped: true, reason: 'No Trustpilot page' };
    }

    console.log(`  ✓ Found: ${trustpilot.url}`);
    console.log(`  Found ${reviews.length} negative reviews`);

    if (reviews.length === 0) {
      await writeOutreach({
        ceoName: company.ceoName,
        ceoEmail: company.email,
        company: company.company,
        trustpilotUrl: trustpilot.url,
        painPoints: 'No negative reviews found',
        generatedEmail: 'N/A - No pain points to address',
        status: 'Skipped - No negative reviews'
      });
      return { success: true, skipped: true, reason: 'No negative reviews' };
    }

    // Step 3: Analyze pain points with AI
    console.log('  [3/5] Analyzing pain points...');
    const painPoints = await analyzeReviewsWithAI(reviews, company.company);
    console.log(`  Pain points: ${painPoints}`);

    // Step 4: Generate personalized email with A/B testing
    console.log('  [4/4] Generating outreach email (A/B testing)...');

    // Randomly select variant A, B, or C for A/B testing
    const variants = ['A', 'B', 'C'];
    const selectedVariant = variants[Math.floor(Math.random() * variants.length)];

    const emailResult = await generateEmail({
      ceoName: company.ceoName,
      reviews: reviews,
      company: company.company,
      variant: selectedVariant
    });

    console.log(`  ✓ Email generated (Variant ${selectedVariant})`);

    // Step 5: Write to Google Sheet (kept as 5 for UX consistency)
    console.log('  [5/5] Writing to Emails tab...');
    await writeOutreach({
      ceoName: company.ceoName,
      ceoEmail: company.email,
      company: company.company,
      trustpilotUrl: trustpilot.url,
      painPoints,
      generatedEmail: emailResult,
      status: `Ready for review (Variant ${selectedVariant})`
    });
    console.log('  ✓ Complete!');

    return { success: true, skipped: false };

  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);

    try {
      await writeOutreach({
        ceoName: company.ceoName,
        ceoEmail: company.email,
        company: company.company,
        trustpilotUrl: '',
        painPoints: 'Error during processing',
        generatedEmail: `Error: ${error.message}`,
        status: 'Failed'
      });
    } catch (writeError) {
      console.error(`  Could not write error to sheet: ${writeError.message}`);
    }

    return { success: false, error: error.message };
  }
}

/**
 * Main orchestration function
 */
async function main() {
  console.log(BANNER);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const testMode = args.includes('--test');
  const startRowArg = args.find(a => a.startsWith('--start='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const startRow = startRowArg ? parseInt(startRowArg.split('=')[1]) : 18;
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

  if (testMode) {
    console.log('🧪 TEST MODE: Processing only the first company\n');
  }
  console.log(`📍 Starting from row: ${startRow}`);
  if (limit) {
    console.log(`📊 Limit: ${limit} companies`);
  }
  console.log('');

  // Validate configuration
  console.log('Checking configuration...');
  const requiredEnv = ['GOOGLE_SHEET_ID', 'GEMINI_API_KEY'];
  const missing = requiredEnv.filter(key => !process.env[key] || process.env[key].includes('your_'));

  if (missing.length > 0) {
    console.error(`\n❌ Missing required configuration: ${missing.join(', ')}`);
    console.error('Please update your .env file with valid values.');
    process.exit(1);
  }
  console.log('✓ Configuration valid\n');

  // Read companies from Google Sheet
  console.log('Reading companies from Google Sheet...');
  let companies;
  try {
    companies = await readCompanies(startRow, limit);
    const limitInfo = limit ? ` (limited to ${limit})` : '';
    console.log(`✓ Found ${companies.length} companies starting from row ${startRow}${limitInfo}\n`);
  } catch (error) {
    console.error(`\n❌ Error reading from Google Sheet: ${error.message}`);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure credentials.json exists and is valid');
    console.error('2. Ensure the service account email has Editor access to the sheet');
    console.error('3. Verify the GOOGLE_SHEET_ID is correct');
    process.exit(1);
  }

  if (companies.length === 0) {
    console.log('No companies found.');
    process.exit(0);
  }

  // Limit to first company in test mode
  const toProcess = testMode ? [companies[0]] : companies;

  // Process each company
  const results = {
    total: toProcess.length,
    successful: 0,
    skipped: 0,
    failed: 0
  };

  for (let i = 0; i < toProcess.length; i++) {
    const company = toProcess[i];
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Company ${i + 1}/${toProcess.length}`);

    const result = await processCompany(company);

    if (result.success) {
      // Mark as processed in Sheet1 (Column A = "email")
      try {
        await markAsProcessed(company.rowNumber);
        console.log(`  ✓ Marked row ${company.rowNumber} as "email" in Sheet1`);
      } catch (markError) {
        console.error(`  Could not mark row as processed: ${markError.message}`);
      }

      if (result.skipped) {
        results.skipped++;
      } else {
        results.successful++;
      }
    } else {
      results.failed++;
    }

    // Add delay between companies to avoid rate limiting
    if (i < toProcess.length - 1) {
      console.log('\n  Waiting 3 seconds before next company...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Print summary
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                        SUMMARY                                 ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total processed:  ${results.total}`);
  console.log(`  Successful:       ${results.successful}`);
  console.log(`  Skipped:          ${results.skipped}`);
  console.log(`  Failed:           ${results.failed}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n✓ Check the "Emails" tab in your Google Sheet for results.');
}

// Run the main function
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});

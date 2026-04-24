#!/usr/bin/env node
import 'dotenv/config';
import { scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';
import { createDraftWithSignature, getSignature } from './src/gmail.js';

// Test with Shein
const testUrl = 'https://www.trustpilot.com/review/www.shein.com';

console.log('Generating 5 more email variations...\n');
console.log('Fetching your Gmail signature...');

try {
  const signature = await getSignature();
  console.log('✓ Signature loaded\n');

  // Scrape reviews
  console.log('Scraping reviews from Shein...');
  const reviews = await scrapeReviews(testUrl, [1, 2], 20);
  console.log(`✓ Found ${reviews.length} reviews\n`);

  if (reviews.length === 0) {
    console.log('No reviews found');
    process.exit(0);
  }

  const testCases = [
    { name: 'Emma Wilson', company: 'FashionRetail Co', reviews: reviews.slice(0, 8) },
    { name: 'Michael Chen', company: 'StyleHub', reviews: reviews.slice(2, 10) },
    { name: 'Lisa Rodriguez', company: 'TrendWear', reviews: reviews.slice(5, 13) },
    { name: 'David Park', company: 'ModaShop', reviews: reviews.slice(8, 16) },
    { name: 'Sarah Thompson', company: 'ChicBoutique', reviews: reviews.slice(10, 18) }
  ];

  const generatedEmails = [];

  console.log('Generating emails...\n');

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];

    console.log(`[${i + 1}/5] Generating for ${test.name}...`);

    const email = await generateEmail({
      ceoName: test.name,
      reviews: test.reviews,
      trustpilotRating: 2.1,
      company: test.company
    });

    generatedEmails.push({
      ceoName: test.name,
      company: test.company,
      email: email
    });

    console.log(`✓ Generated for ${test.name}\n`);
  }

  // Display all emails
  console.log('\n========================================');
  console.log('GENERATED EMAILS (5 variations)');
  console.log('========================================\n');

  generatedEmails.forEach((item, i) => {
    console.log(`--- EMAIL ${i + 1} (${item.ceoName} - ${item.company}) ---`);
    console.log(item.email);
    console.log('\n');
  });

  // Draft to Gmail
  console.log('========================================');
  console.log('Drafting to Gmail...');
  console.log('========================================\n');

  for (let i = 0; i < generatedEmails.length; i++) {
    const item = generatedEmails[i];

    // Parse email
    const lines = item.email.split('\n');
    const subjectLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
    const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, '').trim() : 'trustpilot pattern';

    // Get body (everything after subject)
    const bodyStart = lines.findIndex(l => l.toLowerCase().startsWith('subject:')) + 1;
    const body = lines.slice(bodyStart).join('\n').trim();

    const testEmail = `test${i + 1}@example.com`;

    try {
      const draft = await createDraftWithSignature(testEmail, subject, body);
      console.log(`✓ [${i + 1}/5] Draft created: "${subject}" (ID: ${draft.id})`);
    } catch (error) {
      console.error(`✗ [${i + 1}/5] Failed: ${error.message}`);
    }

    // Small delay
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n========================================');
  console.log('✓ Complete! Check your Gmail Drafts');
  console.log('========================================\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

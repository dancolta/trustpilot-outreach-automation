#!/usr/bin/env node
import 'dotenv/config';
import { scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';
import { createDraftWithSignature } from './src/gmail.js';

const testUrl = 'https://www.trustpilot.com/review/www.shein.com';

console.log('Drafting 3 final test emails to Gmail...\n');

try {
  const reviews = await scrapeReviews(testUrl, [1, 2], 15);
  console.log(`✓ Found ${reviews.length} reviews\n`);

  const testCases = [
    { name: 'Alex Martinez', company: 'RetailPro', variant: 'A' },
    { name: 'Jessica Wang', company: 'ShopWave', variant: 'B' },
    { name: 'Robert Kim', company: 'TrendLine', variant: 'C' }
  ];

  console.log('Generating and drafting emails...\n');

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];

    console.log(`[${i + 1}/3] ${test.name} (${test.company}) - Variant ${test.variant}`);

    const result = await generateEmail({
      ceoName: test.name,
      reviews: reviews,
      company: test.company
    });

    const selectedVariant = result.variants[test.variant];
    const email = selectedVariant.email;

    // Show email in terminal
    console.log('\n' + '-'.repeat(60));
    console.log(email);
    console.log('-'.repeat(60) + '\n');

    // Parse email
    const lines = email.split('\n');
    const subjectLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
    const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, '').trim() : 'test';

    const bodyStart = lines.findIndex(l => l.toLowerCase().startsWith('subject:')) + 1;
    const body = lines.slice(bodyStart).join('\n').trim();

    // Draft to Gmail
    const testEmail = `finaltest${i + 1}@example.com`;

    try {
      const draft = await createDraftWithSignature(testEmail, subject, body);
      console.log(`✓ Drafted to Gmail (ID: ${draft.id})`);
      console.log(`  Strategy: ${selectedVariant.strategy}\n`);
    } catch (error) {
      console.error(`✗ Failed: ${error.message}\n`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('='.repeat(60));
  console.log('✓ COMPLETE - Check your Gmail Drafts!');
  console.log('='.repeat(60));
  console.log('\n3 final test emails drafted.');
  console.log('Check that the CTA question is on a new line.\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

#!/usr/bin/env node
import 'dotenv/config';
import { scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';
import { createDraftWithSignature } from './src/gmail.js';

const testUrl = 'https://www.trustpilot.com/review/www.shein.com';

console.log('Drafting 5 test emails to Gmail...\n');

try {
  const reviews = await scrapeReviews(testUrl, [1, 2], 15);
  console.log(`✓ Found ${reviews.length} reviews\n`);

  const testCases = [
    { name: 'Sarah Chen', company: 'StyleHub', variant: 'A' },
    { name: 'Marcus Rodriguez', company: 'TrendWear', variant: 'B' },
    { name: 'Emily Park', company: 'FashionCo', variant: 'C' },
    { name: 'David Miller', company: 'ModaStore', variant: 'A' },
    { name: 'Lisa Thompson', company: 'ChicShop', variant: 'B' }
  ];

  console.log('Generating and drafting emails...\n');

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];

    console.log(`[${i + 1}/5] ${test.name} (${test.company}) - Variant ${test.variant}`);

    // Generate all 3 variants
    const result = await generateEmail({
      ceoName: test.name,
      reviews: reviews,
      company: test.company
    });

    // Select the specified variant
    const selectedVariant = result.variants[test.variant];
    const email = selectedVariant.email;

    // Parse email
    const lines = email.split('\n');
    const subjectLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
    const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, '').trim() : 'test';

    const bodyStart = lines.findIndex(l => l.toLowerCase().startsWith('subject:')) + 1;
    const body = lines.slice(bodyStart).join('\n').trim();

    // Draft to Gmail
    const testEmail = `test${i + 1}@example.com`;

    try {
      const draft = await createDraftWithSignature(
        testEmail,
        `[${test.variant}] ${subject}`,
        body
      );
      console.log(`✓ Drafted: "${subject}" (${selectedVariant.strategy})`);
      console.log(`  ID: ${draft.id}\n`);
    } catch (error) {
      console.error(`✗ Failed: ${error.message}\n`);
    }

    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('='.repeat(60));
  console.log('✓ COMPLETE - Check your Gmail Drafts!');
  console.log('='.repeat(60));
  console.log('\n5 drafts created:');
  console.log('  [A] Sarah Chen - Direct Value approach');
  console.log('  [B] Marcus Rodriguez - Curiosity Gap approach');
  console.log('  [C] Emily Park - Peer Comparison approach');
  console.log('  [A] David Miller - Direct Value approach');
  console.log('  [B] Lisa Thompson - Curiosity Gap approach');
  console.log('\nEach draft includes your Gmail signature.\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

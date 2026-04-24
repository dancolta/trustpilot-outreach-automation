#!/usr/bin/env node
import 'dotenv/config';
import { scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';
import { createDraftWithSignature } from './src/gmail.js';

const testUrl = 'https://www.trustpilot.com/review/www.shein.com';

console.log('='.repeat(60));
console.log('A/B TEST EMAIL GENERATION');
console.log('='.repeat(60));
console.log('\nScraping reviews...\n');

try {
  const reviews = await scrapeReviews(testUrl, [1, 2], 15);
  console.log(`✓ Found ${reviews.length} reviews\n`);

  // Test with 2 different companies
  const testCases = [
    { name: 'Sarah Martinez', company: 'StyleCo' },
    { name: 'James Chen', company: 'ModaShop' }
  ];

  for (const testCase of testCases) {
    console.log('\n' + '='.repeat(60));
    console.log(`GENERATING FOR: ${testCase.name} (${testCase.company})`);
    console.log('='.repeat(60));

    const result = await generateEmail({
      ceoName: testCase.name,
      reviews: reviews,
      company: testCase.company
    });

    console.log('\n--- VARIANT A: Direct Value ---');
    console.log(result.variants.A.email);

    console.log('\n--- VARIANT B: Curiosity Gap ---');
    console.log(result.variants.B.email);

    console.log('\n--- VARIANT C: Peer Comparison ---');
    console.log(result.variants.C.email);

    console.log('\n' + '-'.repeat(60));
    console.log('Drafting to Gmail...');
    console.log('-'.repeat(60));

    // Draft all 3 variants to Gmail
    for (const [variantKey, variantData] of Object.entries(result.variants)) {
      const lines = variantData.email.split('\n');
      const subjectLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
      const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, '').trim() : 'test';

      const bodyStart = lines.findIndex(l => l.toLowerCase().startsWith('subject:')) + 1;
      const body = lines.slice(bodyStart).join('\n').trim();

      const testEmail = `test-${variantKey.toLowerCase()}@example.com`;

      try {
        const draft = await createDraftWithSignature(testEmail, `[${variantKey}] ${subject}`, body);
        console.log(`✓ Variant ${variantKey} drafted (${variantData.strategy})`);
      } catch (error) {
        console.error(`✗ Variant ${variantKey} failed: ${error.message}`);
      }

      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✓ Complete! Check your Gmail Drafts');
  console.log('='.repeat(60));
  console.log('\nYou should see 6 drafts (3 variants × 2 people)');
  console.log('Subject lines are prefixed with [A], [B], or [C]\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

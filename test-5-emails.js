#!/usr/bin/env node
import 'dotenv/config';
import { scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';

const testUrl = 'https://www.trustpilot.com/review/www.shein.com';

console.log('Generating 5 test emails (showing all 3 A/B variants each)...\n');

try {
  const reviews = await scrapeReviews(testUrl, [1, 2], 15);
  console.log(`✓ Found ${reviews.length} reviews\n`);

  const testCases = [
    { name: 'Sarah Chen', company: 'StyleHub' },
    { name: 'Marcus Rodriguez', company: 'TrendWear' },
    { name: 'Emily Park', company: 'FashionCo' },
    { name: 'David Miller', company: 'ModaStore' },
    { name: 'Lisa Thompson', company: 'ChicShop' }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];

    console.log('='.repeat(70));
    console.log(`EMAIL ${i + 1}: ${test.name} (${test.company})`);
    console.log('='.repeat(70));

    const result = await generateEmail({
      ceoName: test.name,
      reviews: reviews,
      company: test.company
    });

    console.log('\n📧 VARIANT A - Direct Value');
    console.log('-'.repeat(70));
    console.log(result.variants.A.email);

    console.log('\n📧 VARIANT B - Curiosity Gap');
    console.log('-'.repeat(70));
    console.log(result.variants.B.email);

    console.log('\n📧 VARIANT C - Peer Comparison');
    console.log('-'.repeat(70));
    console.log(result.variants.C.email);
    console.log('\n');
  }

  console.log('='.repeat(70));
  console.log('✓ TEST COMPLETE');
  console.log('='.repeat(70));
  console.log('\nReview the emails above.');
  console.log('If you approve, I\'ll apply these changes to the main workflow.\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

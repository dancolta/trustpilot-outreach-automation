#!/usr/bin/env node
import 'dotenv/config';
import { scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';

// Test with a known e-commerce company
const testUrl = 'https://www.trustpilot.com/review/www.shein.com';
const testCEO = 'Chris Xu';
const testCompany = 'Shein';

console.log('Testing new email framework...\n');
console.log('Company:', testCompany);
console.log('Scraping reviews from:', testUrl);
console.log('');

try {
  // Scrape reviews
  const reviews = await scrapeReviews(testUrl, [1, 2], 10);
  console.log(`Found ${reviews.length} negative reviews\n`);

  if (reviews.length === 0) {
    console.log('No reviews found - trying different company');
    process.exit(0);
  }

  // Show sample reviews
  console.log('Sample reviews:');
  reviews.slice(0, 3).forEach((r, i) => {
    console.log(`${i + 1}. [${r.rating}★] "${r.title}"`);
    console.log(`   ${r.text.substring(0, 100)}...`);
    console.log('');
  });

  // Generate email 1
  console.log('\n========================================');
  console.log('GENERATED EMAIL #1');
  console.log('========================================\n');

  const email1 = await generateEmail({
    ceoName: testCEO,
    reviews: reviews,
    trustpilotRating: 2.1,
    company: testCompany
  });

  console.log(email1);

  // Generate email 2 (with different CEO name for variety)
  console.log('\n========================================');
  console.log('GENERATED EMAIL #2 (Different variation)');
  console.log('========================================\n');

  const email2 = await generateEmail({
    ceoName: 'Sarah Chen',
    reviews: reviews.slice(3, 10),
    trustpilotRating: 2.1,
    company: 'TestCompany'
  });

  console.log(email2);

  console.log('\n========================================');
  console.log('Test complete!');
  console.log('========================================\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

#!/usr/bin/env node
import 'dotenv/config';
import { findTrustpilotPage, scrapeReviews } from './src/trustpilot.js';
import { generateEmail } from './src/emailGen.js';

const company = {
  name: "Example Company",
  website: "https://example.com",
  ceoName: "John Doe"
};

console.log("Searching for company on Trustpilot...\n");

try {
  const result = await findTrustpilotPage(company.website, company.name);

  if (result.found) {
    console.log(`✓ Found: ${result.url}`);
    console.log(`Rating: ${result.rating}\n`);

    console.log('Scraping negative reviews...');
    const reviews = await scrapeReviews(result.url, [1, 2], 15);
    console.log(`Found ${reviews.length} negative reviews\n`);

    if (reviews.length > 0) {
      console.log('Sample reviews:');
      reviews.slice(0, 5).forEach((r, i) => {
        console.log(`${i + 1}. [${r.rating}★] "${r.title}"`);
        console.log(`   ${r.text}`);
        console.log('');
      });

      console.log('\n' + '='.repeat(60));
      console.log('GENERATING APOLOGY + PITCH EMAIL');
      console.log('='.repeat(60) + '\n');

      // Generate all 3 variants
      const emailResult = await generateEmail({
        ceoName: company.ceoName,
        reviews: reviews,
        company: company.name
      });

      console.log('--- VARIANT A ---');
      console.log(emailResult.variants.A.email);
      console.log('\n--- VARIANT B ---');
      console.log(emailResult.variants.B.email);
      console.log('\n--- VARIANT C ---');
      console.log(emailResult.variants.C.email);

    } else {
      console.log('No negative reviews found - company has good reputation!');
      console.log('\nSuggested reply: Just apologize for the mix-up without pitch.');
    }
  } else {
    console.log('✗ No Trustpilot page found');
    console.log('\nSuggested reply: Just apologize for the mix-up without pitch.');
  }
} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
}

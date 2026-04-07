#!/usr/bin/env node
import 'dotenv/config';
import { createDraft } from './src/gmail.js';

const testEmails = [
  {
    to: 'test@example.com',
    subject: 'delivery pattern',
    body: `Chris,

I noticed 10 "delivery" or "not received" complaints on Shein's Trustpilot in the last month.

"THE WHOLE PARCEL DELIVERED BUT NOT RECEIVED"

I've worked with e-commerce companies seeing similar fulfillment issues.

Worth comparing notes on what resolves these delivery gaps?`
  },
  {
    to: 'test2@example.com',
    subject: 'delivery issues',
    body: `Sarah,

TestCompany's Trustpilot shows 7 undelivered order complaints in the last month.

"THE WHOLE PARCEL DELIVERED BUT NOT RECEIVED...I never received the package...UPS has no proof of delivery"

I've seen similar issues with logistics and last-mile delivery in e-commerce.

Worth comparing notes on what's helped others in similar situations?`
  }
];

console.log('Creating draft emails in your Gmail inbox...\n');

for (const email of testEmails) {
  try {
    const draft = await createDraft(email.to, email.subject, email.body);
    console.log(`✓ Draft created: "${email.subject}" (ID: ${draft.id})`);
  } catch (error) {
    console.error(`✗ Failed to create draft: ${error.message}`);
  }
}

console.log('\n✓ Check your Gmail Drafts folder!');

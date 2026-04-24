#!/usr/bin/env node
import 'dotenv/config';
import { getAllEmails } from './src/sheets.js';
import { createDraftWithSignature, getMyEmail } from './src/gmail.js';

// The 9 companies we want to draft (from rows 160-170)
const TARGET_COMPANIES = [
  'Rocksbox',
  'Passion Planner',
  'King Ice',
  'Grounded',
  'Côte Beauty',
  'Meissner Sewing',
  'SPLITS59',
  'Ever Pretty Wholesale',
  'Brochu Walker'
];

function parseEmailDraft(emailText) {
  if (!emailText || typeof emailText !== 'string') {
    return { subject: '', body: '' };
  }

  const lines = emailText.trim().split('\n');
  const firstLine = lines[0]?.trim() || '';

  if (firstLine.toLowerCase().startsWith('subject:')) {
    const subject = firstLine.replace(/^subject:\s*/i, '').trim();
    const bodyLines = lines.slice(1);
    const firstNonEmptyIndex = bodyLines.findIndex(l => l.trim() !== '');
    const body = bodyLines.slice(firstNonEmptyIndex).join('\n').trim();
    return { subject, body };
  }

  return {
    subject: firstLine.substring(0, 100),
    body: emailText.trim()
  };
}

async function main() {
  console.log('\n========================================');
  console.log('📧 Draft 9 Specific Emails');
  console.log('========================================\n');

  try {
    // Verify Gmail connection
    console.log('Connecting to Gmail...');
    const myEmail = await getMyEmail();
    console.log(`✓ Connected as: ${myEmail}\n`);

    console.log('Fetching emails from sheet...');
    const allEmails = await getAllEmails();

    // Filter for our 9 target companies
    const targetEmails = allEmails.filter(e =>
      TARGET_COMPANIES.some(name =>
        e.company.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(e.company.toLowerCase())
      )
    );

    console.log(`✓ Found ${targetEmails.length} emails to draft\n`);

    if (targetEmails.length === 0) {
      console.log('❌ No matching emails found');
      return;
    }

    // Draft each email
    let successCount = 0;

    for (const email of targetEmails) {
      const { subject, body } = parseEmailDraft(email.email);

      console.log(`----------------------------------------`);
      console.log(`Company: ${email.company}`);
      console.log(`To: ${email.ceoEmail}`);
      console.log(`Subject: ${subject || '(no subject)'}`);

      if (!email.ceoEmail || !body) {
        console.log(`❌ Skipped - Missing data`);
        continue;
      }

      try {
        const draft = await createDraftWithSignature(email.ceoEmail, subject, body);
        console.log(`✓ Draft created (ID: ${draft.id})`);
        successCount++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.log(`❌ Failed: ${err.message}`);
      }
    }

    console.log(`\n========================================`);
    console.log(`✓ Completed: ${successCount} drafts created`);
    console.log(`========================================\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

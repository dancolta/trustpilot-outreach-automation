#!/usr/bin/env node
/**
 * Draft Emails Script
 *
 * Reads emails from the "Emails" tab in Google Sheets and creates
 * drafts in Gmail inbox.
 *
 * Usage:
 *   npm run draft-emails           # Draft all "Ready for review" emails
 *   npm run draft-emails -- --all  # Draft all emails (except already drafted)
 *   npm run draft-emails -- --row=5  # Draft specific row only
 *   npm run draft-emails -- --dry-run # Preview without creating drafts
 */

import 'dotenv/config';
import { getAllEmails, getEmailRow, updateStatus } from './sheets.js';
import { createDraftWithSignature, getMyEmail } from './gmail.js';

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
  all: args.includes('--all'),
  row: args.find(a => a.startsWith('--row='))?.split('=')[1],
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force') // Force re-draft even if already drafted
};

/**
 * Parse email draft to extract subject and body
 * Expected format: "Subject: [subject]\n\n[body]" or just body
 */
function parseEmailDraft(emailText) {
  if (!emailText || typeof emailText !== 'string') {
    return { subject: '', body: '' };
  }

  const lines = emailText.trim().split('\n');

  // Check if first line is a subject line
  const firstLine = lines[0]?.trim() || '';

  if (firstLine.toLowerCase().startsWith('subject:')) {
    const subject = firstLine.replace(/^subject:\s*/i, '').trim();
    // Body is everything after subject line (skip empty lines after subject)
    const bodyLines = lines.slice(1);
    const firstNonEmptyIndex = bodyLines.findIndex(l => l.trim() !== '');
    const body = bodyLines.slice(firstNonEmptyIndex).join('\n').trim();
    return { subject, body };
  }

  // No subject line found - use first line as subject, rest as body
  return {
    subject: firstLine.substring(0, 100), // Truncate if too long
    body: emailText.trim()
  };
}

/**
 * Main execution function
 */
async function main() {
  console.log('\n========================================');
  console.log('📧 Draft Emails to Gmail');
  console.log('========================================\n');

  try {
    // Verify Gmail connection first
    console.log('Connecting to Gmail...');
    const myEmail = await getMyEmail();
    console.log(`✓ Connected as: ${myEmail}\n`);

    let emails = [];

    // Get emails to process
    if (flags.row) {
      const rowNum = parseInt(flags.row);
      console.log(`Fetching row ${rowNum}...`);
      const email = await getEmailRow(rowNum);
      if (email) {
        // Skip if already drafted (unless --force)
        if (email.status === 'Drafted' && !flags.force) {
          console.log(`⏭ Row ${rowNum} already drafted. Use --force to re-draft.`);
          return;
        }
        emails = [email];
      } else {
        console.log(`❌ Row ${rowNum} not found`);
        return;
      }
    } else {
      console.log('Fetching emails from sheet...');
      const allEmails = await getAllEmails();

      if (flags.all) {
        // All emails except already drafted (unless --force)
        emails = allEmails.filter(e =>
          e.ceoEmail &&
          e.email &&
          (flags.force || e.status !== 'Drafted')
        );
      } else {
        // Only process "Ready for review" or "Edited" status (never re-draft)
        // Also match "Ready for review (Variant X)" format
        emails = allEmails.filter(e =>
          e.ceoEmail &&
          e.email &&
          (e.status === 'Ready for review' ||
           e.status === 'Edited' ||
           e.status?.startsWith('Ready for review (Variant'))
        );
      }
    }

    if (emails.length === 0) {
      console.log('No emails to draft.');
      console.log('Make sure emails have:');
      console.log('  - CEO Email (Column C)');
      console.log('  - Email Draft (Column F)');
      console.log('  - Status: "Ready for review" or "Edited"');
      console.log('\nUse --all flag to draft all emails (skips already drafted).');
      console.log('Use --force flag to re-draft already drafted emails.');
      return;
    }

    console.log(`Found ${emails.length} email(s) to draft\n`);

    if (flags.dryRun) {
      console.log('🔍 DRY RUN - No drafts will be created\n');
    }

    // Track processed emails to avoid duplicates in same run
    const processedEmails = new Set();

    // Process each email
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const email of emails) {
      // Skip duplicate email addresses in same batch
      const emailKey = email.ceoEmail.toLowerCase();
      if (processedEmails.has(emailKey)) {
        console.log(`----------------------------------------`);
        console.log(`Company: ${email.company}`);
        console.log(`To: ${email.ceoEmail}`);
        console.log(`⏭ Skipped - Duplicate email in batch`);
        skippedCount++;
        continue;
      }

      const { subject, body } = parseEmailDraft(email.email);

      console.log(`----------------------------------------`);
      console.log(`Company: ${email.company}`);
      console.log(`To: ${email.ceoEmail}`);
      console.log(`Subject: ${subject || '(no subject)'}`);

      if (!email.ceoEmail) {
        console.log(`❌ Skipped - No email address`);
        failCount++;
        continue;
      }

      if (!subject && !body) {
        console.log(`❌ Skipped - Empty email draft`);
        failCount++;
        continue;
      }

      if (flags.dryRun) {
        console.log(`✓ Would create draft`);
        processedEmails.add(emailKey);
        successCount++;
        continue;
      }

      try {
        const draft = await createDraftWithSignature(email.ceoEmail, subject, body);
        console.log(`✓ Draft created (ID: ${draft.id})`);

        // Mark as drafted in the sheet
        await updateStatus(email.company, 'Drafted');
        console.log(`✓ Status updated to "Drafted"`);

        processedEmails.add(emailKey);
        successCount++;

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.log(`❌ Failed: ${err.message}`);
        failCount++;
      }
    }

    console.log(`\n========================================`);
    console.log(`✓ Completed: ${successCount} drafts created`);
    if (skippedCount > 0) {
      console.log(`⏭ Skipped: ${skippedCount} (duplicates)`);
    }
    if (failCount > 0) {
      console.log(`✗ Failed: ${failCount}`);
    }
    console.log(`========================================\n`);
    console.log('Check your Gmail Drafts folder!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('credentials')) {
      console.log('\nSee README for Gmail API setup instructions.');
    }
    process.exit(1);
  }
}

main();

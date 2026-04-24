#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

// The 7 draft IDs to send
const DRAFT_IDS = [
  'r-2876502144724388159',   // BOXFOX, Inc.
  'r8211855744702907991',    // Triple Aught Design
  'r2162770798672667163',    // Faviana International
  'r3548159389556215850',    // Total Beauty Experience
  'r8812943109960779672',    // SlideBelts
  'r-5573810423431566082',   // PQ Swim
  'r2508598013105948602',    // FANCL International, Inc.
];

async function getGmailClient() {
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH || './gmail-credentials.json';
  const tokenPath = './gmail-token.json';

  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  const token = JSON.parse(readFileSync(tokenPath, 'utf8'));

  const { client_id, client_secret } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3333/oauth2callback'
  );

  oauth2Client.setCredentials(token);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function sendAllDrafts() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('📧 SENDING ALL DRAFTS IMMEDIATELY');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const gmail = await getGmailClient();

  // Get draft details first
  console.log('Loading draft details...\n');
  const draftDetails = [];

  for (const draftId of DRAFT_IDS) {
    try {
      const draft = await gmail.users.drafts.get({ userId: 'me', id: draftId });
      const headers = draft.data.message.payload.headers;
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      draftDetails.push({ draftId, to, subject });
    } catch (error) {
      draftDetails.push({ draftId, to: 'Unknown', subject: 'Error loading draft', error: error.message });
    }
  }

  let successCount = 0;
  let failCount = 0;

  // Send each draft
  for (let i = 0; i < DRAFT_IDS.length; i++) {
    const draftId = DRAFT_IDS[i];
    const detail = draftDetails[i];

    console.log(`[${i + 1}/${DRAFT_IDS.length}] Sending...`);
    console.log(`   To: ${detail.to}`);
    console.log(`   Subject: ${detail.subject}`);

    if (detail.error) {
      console.log(`   ✗ Failed: ${detail.error}\n`);
      failCount++;
      continue;
    }

    try {
      await gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: draftId }
      });

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      });

      console.log(`   ✓ Sent at ${timeStr}\n`);
      successCount++;

      // Small delay between sends
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}\n`);
      failCount++;
    }
  }

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`✅ COMPLETED: ${successCount} sent, ${failCount} failed`);
  console.log('══════════════════════════════════════════════════════════════════════\n');
}

sendAllDrafts().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});

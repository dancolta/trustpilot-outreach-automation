#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

// Draft IDs from the previous run
const DRAFT_IDS = [
  'r-6530371243459501995',  // VIOLET GREY
  'r-7451445349520101307',  // Ingrid + Isabel
  'r-8117272524859948957',  // Trixxi Clothing Co.
  'r6031980292904655363',   // Senior.com
  'r-4621487374893490367',  // UNITED NUDE
  'r-1248113326190262884',  // Hale Bob
  'r-4041430944566732790',  // Oru Kayak
  'r-2813151674581961563',  // Ellusionist
  'r-3042006913891062349'   // Impressions Vanity
];

// Get OAuth client
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

// Calculate send times within next hour with 4-6 minute intervals
function calculateSendTimes(count) {
  const times = [];
  const now = new Date();

  // Start sending in 2 minutes
  const startTime = new Date(now.getTime() + 2 * 60 * 1000);
  times.push(startTime);

  // Add remaining emails with random 4-6 minute intervals
  let currentTime = new Date(startTime);
  for (let i = 1; i < count; i++) {
    // Random interval between 4 and 6 minutes (in milliseconds)
    const randomInterval = (4 + Math.random() * 2) * 60 * 1000;
    currentTime = new Date(currentTime.getTime() + randomInterval);
    times.push(currentTime);
  }

  return times;
}

async function scheduleDrafts() {
  console.log('=' .repeat(70));
  console.log('EMAIL SCHEDULING - Next Hour (4-6 min intervals)');
  console.log('=' .repeat(70));
  console.log('');

  const sendTimes = calculateSendTimes(DRAFT_IDS.length);

  console.log(`📅 SCHEDULE FOR ${DRAFT_IDS.length} EMAILS:\n`);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });

  for (let i = 0; i < sendTimes.length; i++) {
    const timeStr = formatter.format(sendTimes[i]);
    console.log(`  ${i + 1}. ${timeStr}`);
  }

  console.log('');
  console.log('─'.repeat(70));
  console.log('');
  console.log('⚠️  Gmail API does not support native scheduling.');
  console.log('');
  console.log('📍 OPTION 1: Manual Scheduling in Gmail (RECOMMENDED)');
  console.log('   1. Open Gmail → Drafts');
  console.log('   2. Open each draft');
  console.log('   3. Click ▼ next to "Send" button');
  console.log('   4. Click "Schedule send"');
  console.log('   5. Choose "Pick date & time"');
  console.log('   6. Enter the time from schedule above');
  console.log('');
  console.log('🤖 OPTION 2: Auto-Send with This Script');
  console.log('   - Keeps script running in background');
  console.log('   - Auto-sends at scheduled times');
  console.log('   - Run: node schedule-emails.js --auto-send');
  console.log('');
  console.log('─'.repeat(70));

  // Check if auto-send flag is set
  const autoSend = process.argv.includes('--auto-send');

  if (autoSend) {
    console.log('');
    console.log('🚀 AUTO-SEND MODE ENABLED');
    console.log('─'.repeat(70));
    console.log('Keep this terminal window open.\n');

    const gmail = await getGmailClient();

    for (let i = 0; i < DRAFT_IDS.length; i++) {
      const draftId = DRAFT_IDS[i];
      const sendTime = sendTimes[i];
      const now = new Date();
      const delay = sendTime - now;

      const timeStr = formatter.format(sendTime);

      if (delay > 0) {
        const waitMinutes = Math.round(delay / 60000);
        console.log(`[${i + 1}/${DRAFT_IDS.length}] Waiting ${waitMinutes} min until ${timeStr}...`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        await gmail.users.drafts.send({
          userId: 'me',
          requestBody: { id: draftId }
        });
        const sentTime = formatter.format(new Date());
        console.log(`✓ Sent at ${sentTime}`);
      } catch (error) {
        console.error(`✗ Failed: ${error.message}`);
      }

      // Small delay between sends
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n' + '=' .repeat(70));
    console.log('✅ ALL EMAILS SENT');
    console.log('=' .repeat(70));
  }
}

scheduleDrafts().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});

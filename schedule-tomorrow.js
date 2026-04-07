#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

// Draft IDs from today's batch (rows 140-159)
const DRAFT_IDS = [
  'r2661308023740220386',  // Wildflower Cases
  'r90435388199205430',    // Honeydew
  'r7783175714214914193',  // SOUL Project
  'r5199704715545236498',  // Bravo Farms
  'r4946751682715530215',  // Kiyonna Clothing
  'r6232720003737671506',  // SKINACT
  'r3183626047602401664',  // Linea Pelle
  'r4264016282172246810',  // EastEssence
  'r-8470220087795606415', // American Giant
  'r-5799591788411498034', // Energy Muse
  'r5062389013233773174',  // Slumberkins
  'r4784064677813601710',  // JBK International
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

// Calculate send times for tomorrow 9am-3pm LA time
function calculateSendTimes(count) {
  const times = [];

  // Get current LA time
  const nowLA = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const nowLADate = new Date(nowLA);

  // Set to tomorrow at 9 AM LA time
  const tomorrowLA = new Date(nowLADate);
  tomorrowLA.setDate(tomorrowLA.getDate() + 1);
  tomorrowLA.setHours(9, 0, 0, 0);

  // Convert back to UTC for actual scheduling
  // Get the LA time string and parse it to UTC
  const laTimeStr = tomorrowLA.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // PST is UTC-8, so 9 AM PST = 5 PM UTC (previous day if before midnight)
  // Create proper UTC time: Feb 2, 9 AM PST = Feb 2, 5 PM UTC
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setUTCHours(17, 0, 0, 0); // 9 AM PST = 5 PM UTC

  const startHour = 9;  // 9 AM LA
  const endHour = 15;   // 3 PM LA
  const windowHours = endHour - startHour; // 6 hours

  // Spread emails evenly across the time window
  const intervalMinutes = Math.floor((windowHours * 60) / (count - 1 || 1));

  for (let i = 0; i < count; i++) {
    const sendTime = new Date(tomorrow);
    sendTime.setUTCMinutes(sendTime.getUTCMinutes() + (i * intervalMinutes));
    times.push(sendTime);
  }

  return times;
}

async function scheduleDrafts() {
  console.log('='.repeat(70));
  console.log('EMAIL SCHEDULING - Tomorrow 9am-3pm (Los Angeles Time)');
  console.log('='.repeat(70));
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
  console.log('   - Run: node schedule-tomorrow.js --auto-send');
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

    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL EMAILS SENT');
    console.log('='.repeat(70));
  }
}

scheduleDrafts().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});

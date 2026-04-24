#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

// Get the 7 most recent draft IDs
const DRAFT_IDS = [
  'r-2876502144724388159',   // BOXFOX, Inc.
  'r8211855744702907991',    // Triple Aught Design
  'r2162770798672667163',    // Faviana International
  'r3548159389556215850',    // Total Beauty Experience
  'r8812943109960779672',    // SlideBelts
  'r-5573810423431566082',   // PQ Swim
  'r2508598013105948602',    // FANCL International, Inc.
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

// Calculate send times spread between 9am-1pm California time
function calculateSendTimes(count, startDate = null) {
  const times = [];

  // Use provided date or default to today
  const baseDate = startDate || new Date();

  // Create a date object in California timezone
  const caTimeStr = baseDate.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Parse to get current CA time
  const [datePart, timePart] = caTimeStr.split(', ');
  const [month, day, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');

  // Check if we're past 1pm CA time today
  const currentCAHour = parseInt(hour);
  const currentCAMinute = parseInt(minute);

  let targetDate = new Date();

  // If it's past 3pm CA time, schedule for tomorrow
  if (currentCAHour > 15 || (currentCAHour === 15 && currentCAMinute > 0)) {
    console.log('⏰ It\'s past 3pm CA time today, scheduling for tomorrow...\n');
    targetDate.setDate(targetDate.getDate() + 1);
  } else {
    console.log('⏰ Scheduling for today between 9am-3pm CA time...\n');
  }

  // Set to 9 AM California time
  // PST is UTC-8, PDT is UTC-7
  // We need to convert 9 AM Pacific to UTC
  const targetDateStr = targetDate.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // Create date at 9 AM Pacific
  const startTime = new Date(targetDateStr + ' 09:00:00 GMT-0800');

  const startHour = 9;  // 9 AM PT
  const endHour = 15;   // 3 PM PT (15:00)
  const windowMinutes = (endHour - startHour) * 60; // 6 hours = 360 minutes

  // Spread emails evenly across the time window
  const intervalMinutes = Math.floor(windowMinutes / (count - 1 || 1));

  for (let i = 0; i < count; i++) {
    const sendTime = new Date(startTime);
    sendTime.setMinutes(sendTime.getMinutes() + (i * intervalMinutes));
    times.push(sendTime);
  }

  return times;
}

async function scheduleDrafts() {
  console.log('═'.repeat(70));
  console.log('📧 EMAIL SCHEDULING - 9am-3pm California Time');
  console.log('═'.repeat(70));
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

  const gmail = await getGmailClient();

  // Get draft details for display
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
      draftDetails.push({ draftId, to: 'Unknown', subject: 'Error loading draft' });
    }
  }

  for (let i = 0; i < sendTimes.length; i++) {
    const timeStr = formatter.format(sendTimes[i]);
    const detail = draftDetails[i];
    console.log(`  ${i + 1}. ${timeStr}`);
    console.log(`     To: ${detail.to}`);
    console.log(`     Subject: ${detail.subject}`);
    console.log('');
  }

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
  console.log('   - Run: node schedule-drafts.js --auto-send');
  console.log('');
  console.log('─'.repeat(70));

  // Check if auto-send flag is set
  const autoSend = process.argv.includes('--auto-send');

  if (autoSend) {
    console.log('');
    console.log('🚀 AUTO-SEND MODE ENABLED');
    console.log('─'.repeat(70));
    console.log('Keep this terminal window open.\n');

    for (let i = 0; i < DRAFT_IDS.length; i++) {
      const draftId = DRAFT_IDS[i];
      const sendTime = sendTimes[i];
      const detail = draftDetails[i];
      const now = new Date();
      const delay = sendTime - now;

      const timeStr = formatter.format(sendTime);

      if (delay > 0) {
        const waitMinutes = Math.round(delay / 60000);
        console.log(`[${i + 1}/${DRAFT_IDS.length}] Waiting ${waitMinutes} min until ${timeStr}...`);
        console.log(`   To: ${detail.to} - ${detail.subject}`);

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.log(`[${i + 1}/${DRAFT_IDS.length}] Time already passed, sending immediately...`);
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

    console.log('\n' + '═'.repeat(70));
    console.log('✅ ALL EMAILS SENT');
    console.log('═'.repeat(70));
  }
}

scheduleDrafts().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});

#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

async function cancelScheduledEmails() {
  // Get OAuth client
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
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  console.log('🔍 CHECKING FOR SCHEDULED EMAILS\n');
  console.log('═'.repeat(60));

  try {
    // List messages in the scheduled folder
    // Note: Gmail API doesn't expose scheduled sends directly via API
    // They appear as drafts with special metadata that can only be cancelled through Gmail UI

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:scheduled'  // Search in scheduled folder
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('✓ No scheduled emails found.\n');
      console.log('All scheduled sends have been cleared or never existed.\n');
      return;
    }

    console.log(`Found ${response.data.messages.length} scheduled email(s)\n`);

    // Get details for each scheduled message
    for (const msg of response.data.messages) {
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['To', 'Subject']
      });

      const headers = message.data.payload.headers;
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';

      console.log(`Message ID: ${msg.id}`);
      console.log(`  To: ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log('');
    }

    console.log('═'.repeat(60));
    console.log('\n⚠️  IMPORTANT: Gmail API cannot cancel scheduled sends programmatically.');
    console.log('You must cancel them manually in Gmail:\n');
    console.log('  1. Go to Gmail → Scheduled folder (left sidebar)');
    console.log('  2. Click on each scheduled email');
    console.log('  3. Click "Cancel send" button\n');

  } catch (error) {
    if (error.message.includes('Label not found')) {
      console.log('✓ No scheduled emails found.\n');
      console.log('The "Scheduled" folder is empty or doesn\'t exist.\n');
    } else {
      console.error('Error:', error.message);
    }
  }
}

cancelScheduledEmails();

#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

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

async function checkRecentSent() {
  const gmail = await getGmailClient();

  console.log('\n📧 RECENT SENT EMAILS (Last 24 hours)\n');
  console.log('═'.repeat(70));

  try {
    // Get sent messages from the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const timestamp = Math.floor(oneDayAgo.getTime() / 1000);

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent after:${timestamp}`,
      maxResults: 20
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('\nNo sent emails found in the last 24 hours.\n');
      console.log('═'.repeat(70));
      return;
    }

    console.log(`\nFound ${response.data.messages.length} sent email(s):\n`);

    for (let i = 0; i < response.data.messages.length; i++) {
      const messageId = response.data.messages[i].id;
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId
      });

      const headers = message.data.payload.headers;
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || 'Unknown';

      // Parse date to LA timezone
      const sentDate = new Date(date);
      const laTime = sentDate.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      });

      console.log(`${i + 1}. ${laTime}`);
      console.log(`   To: ${to}`);
      console.log(`   Subject: ${subject}\n`);
    }

    console.log('═'.repeat(70));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkRecentSent();

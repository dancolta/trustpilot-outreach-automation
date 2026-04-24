#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

async function checkSentEmails() {
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

  console.log('🔍 CHECKING GMAIL ACCOUNT\n');
  console.log('═'.repeat(60));

  try {
    // Get profile
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('Gmail Account:', profile.data.emailAddress);
    console.log('');

    // Check drafts
    const drafts = await gmail.users.drafts.list({ userId: 'me' });
    console.log('Drafts:', drafts.data.drafts?.length || 0);

    // Check sent emails from today
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const sent = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent after:${todayStr}`,
      maxResults: 20
    });

    const sentCount = sent.data.messages?.length || 0;
    console.log('Sent today:', sentCount);
    console.log('');

    if (sentCount > 0) {
      console.log('Recent sent emails:\n');

      for (const msg of sent.data.messages.slice(0, 10)) {
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['To', 'Subject', 'Date']
        });

        const headers = message.data.payload.headers;
        const to = headers.find(h => h.name === 'To')?.value;
        const subject = headers.find(h => h.name === 'Subject')?.value;
        const date = headers.find(h => h.name === 'Date')?.value;

        console.log(`  To: ${to}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Date: ${date}`);
        console.log('');
      }
    }

    console.log('═'.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSentEmails();

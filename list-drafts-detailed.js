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

async function listDrafts() {
  const gmail = await getGmailClient();

  console.log('\n📧 CURRENT GMAIL DRAFTS\n');
  console.log('═'.repeat(60));

  try {
    const response = await gmail.users.drafts.list({
      userId: 'me',
      maxResults: 50
    });

    if (!response.data.drafts || response.data.drafts.length === 0) {
      console.log('\nNo drafts found in Gmail.\n');
      console.log('═'.repeat(60));
      return;
    }

    console.log(`\nFound ${response.data.drafts.length} draft(s):\n`);

    for (let i = 0; i < response.data.drafts.length; i++) {
      const draftId = response.data.drafts[i].id;
      const draft = await gmail.users.drafts.get({ userId: 'me', id: draftId });

      const headers = draft.data.message.payload.headers;
      const to = headers.find(h => h.name === 'To')?.value || 'Unknown';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';

      console.log(`${i + 1}. ID: ${draftId}`);
      console.log(`   To: ${to}`);
      console.log(`   Subject: ${subject}\n`);
    }

    console.log('═'.repeat(60));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listDrafts();

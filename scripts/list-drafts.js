#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

async function listDrafts() {
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

  console.log('📧 GMAIL DRAFTS\n');
  console.log('═'.repeat(60));

  try {
    const drafts = await gmail.users.drafts.list({ userId: 'me' });

    if (!drafts.data.drafts || drafts.data.drafts.length === 0) {
      console.log('No drafts found.\n');
      return;
    }

    console.log(`Total drafts: ${drafts.data.drafts.length}\n`);

    // Get details for recent drafts
    console.log('Recent drafts:');
    for (let i = 0; i < Math.min(10, drafts.data.drafts.length); i++) {
      const draftId = drafts.data.drafts[i].id;
      const draft = await gmail.users.drafts.get({ userId: 'me', id: draftId });

      // Get subject from headers
      const headers = draft.data.message.payload.headers;
      const subjectHeader = headers.find(h => h.name === 'Subject');
      const toHeader = headers.find(h => h.name === 'To');

      console.log(`  ${i + 1}. ID: ${draftId}`);
      console.log(`     To: ${toHeader?.value || 'Unknown'}`);
      console.log(`     Subject: ${subjectHeader?.value || '(no subject)'}`);
      console.log('');
    }

    console.log('═'.repeat(60));
    console.log('\n✓ Check Gmail Drafts folder to review/edit/send\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

listDrafts();

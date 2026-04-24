#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';

async function deleteAllDrafts() {
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

  console.log('🗑️  DELETING ALL DRAFTS\n');
  console.log('═'.repeat(60));

  try {
    const drafts = await gmail.users.drafts.list({ userId: 'me' });

    if (!drafts.data.drafts || drafts.data.drafts.length === 0) {
      console.log('No drafts to delete.\n');
      return;
    }

    console.log(`Found ${drafts.data.drafts.length} drafts to delete...\n`);

    for (let i = 0; i < drafts.data.drafts.length; i++) {
      const draftId = drafts.data.drafts[i].id;
      await gmail.users.drafts.delete({ userId: 'me', id: draftId });
      process.stdout.write(`\rDeleted ${i + 1}/${drafts.data.drafts.length}`);
      await new Promise(r => setTimeout(r, 100)); // Small delay
    }

    console.log('\n\n✓ All drafts deleted\n');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('\nError:', error.message);
  }
}

deleteAllDrafts();

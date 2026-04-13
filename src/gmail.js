import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { URL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic'
];
// Stored next to the source file so it works regardless of cwd
const TOKEN_PATH = path.join(__dirname, '..', 'gmail-token.json');

let gmailClient = null;

/**
 * Get OAuth2 client for Gmail API
 * Requires user authorization (not service account)
 */
async function getOAuth2Client() {
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH || './gmail-credentials.json';

  if (!existsSync(credentialsPath)) {
    throw new Error(`
Gmail OAuth credentials not found at: ${credentialsPath}

To set up Gmail API:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Desktop app)
3. Download JSON and save as gmail-credentials.json
4. Run this script again to authorize
    `);
  }

  const credentials = JSON.parse(readFileSync(path.resolve(credentialsPath), 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3333/oauth2callback'
  );

  // Check for existing token
  if (existsSync(TOKEN_PATH)) {
    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    // Check if token is expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log('Token expired, refreshing...');
      try {
        const { credentials: newToken } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(newToken);
        writeFileSync(TOKEN_PATH, JSON.stringify(newToken));
        gmailClient = null; // force re-init with new credentials
        console.log('Token refreshed successfully');
      } catch (err) {
        console.log('Failed to refresh token, need re-authorization');
        gmailClient = null;
        await authorizeUser(oauth2Client);
      }
    }

    return oauth2Client;
  }

  // Need to authorize
  await authorizeUser(oauth2Client);
  return oauth2Client;
}

/**
 * Open browser for user authorization
 */
async function authorizeUser(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('\n========================================');
  console.log('Gmail Authorization Required');
  console.log('========================================');
  console.log('\nOpening browser for authorization...');
  console.log('If browser doesn\'t open, visit this URL:\n');
  console.log(authUrl);
  console.log('\n========================================\n');

  // Open browser
  const { exec } = await import('child_process');
  exec(`open "${authUrl}"`);

  // Start local server to receive callback
  const code = await waitForAuthCode();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log('✓ Authorization successful! Token saved.\n');
}

/**
 * Start local server and wait for OAuth callback
 */
function waitForAuthCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:3333');
      const code = url.searchParams.get('code');

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f4f8;">
              <div style="text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h1 style="color: #22c55e; margin-bottom: 16px;">✓ Authorization Successful!</h1>
                <p style="color: #64748b;">You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('No code received');
      }
    });

    server.listen(3333, () => {
      console.log('Waiting for authorization...');
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out'));
    }, 120000);
  });
}

/**
 * Initialize Gmail API client
 */
export async function getGmailClient() {
  if (gmailClient) return gmailClient;

  const auth = await getOAuth2Client();
  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

/**
 * Create a draft email in Gmail
 */
export async function createDraft(to, subject, body) {
  const gmail = await getGmailClient();

  // Create email in RFC 2822 format
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ].join('\r\n');

  // Encode to base64url
  const encodedEmail = Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedEmail
      }
    }
  });

  return response.data;
}

/**
 * Get user's Gmail signature
 */
export async function getSignature() {
  const gmail = await getGmailClient();

  try {
    // Get the default send-as alias (primary email)
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;

    const sendAs = await gmail.users.settings.sendAs.get({
      userId: 'me',
      sendAsEmail: email
    });

    return sendAs.data.signature || '';
  } catch (error) {
    console.log('Could not fetch signature:', error.message);
    return '';
  }
}

/**
 * Create a draft email with HTML formatting and signature
 * @param {string} to - recipient email
 * @param {string} subject - email subject
 * @param {string} body - email body (plain text with markdown italics)
 * @param {string} [fromEmail] - optional send-as address to use as sender
 */
export async function createDraftWithSignature(to, subject, body, fromEmail) {
  const gmail = await getGmailClient();

  // Get signature for the sender address
  let signature = '';
  try {
    if (fromEmail) {
      const sendAs = await gmail.users.settings.sendAs.get({
        userId: 'me',
        sendAsEmail: fromEmail
      });
      signature = sendAs.data.signature || '';
    } else {
      signature = await getSignature();
    }
  } catch (e) {
    signature = await getSignature();
  }

  // Convert markdown-style italics (*"text"*) to HTML italics
  let htmlBody = body
    .replace(/\*"([^"]+)"\*/g, '<em>"$1"</em>')  // *"quote"* -> <em>"quote"</em>
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')       // *text* -> <em>text</em>
    .replace(/\n/g, '<br>');                       // newlines to <br>

  // Add signature if exists
  if (signature) {
    htmlBody += '<br><br>--<br>' + signature;
  }

  // Create email in RFC 2822 format with HTML content
  const headers = [`To: ${to}`];
  if (fromEmail) {
    headers.push(`From: ${fromEmail}`);
  }
  headers.push(
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8'
  );

  const email = [...headers, '', htmlBody].join('\r\n');

  // Encode to base64url
  const encodedEmail = Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedEmail
      }
    }
  });

  return response.data;
}

/**
 * Update (replace) an existing Gmail draft
 */
export async function updateDraft(draftId, to, subject, body, fromEmail) {
  const gmail = await getGmailClient();

  let signature = '';
  try {
    if (fromEmail) {
      const sendAs = await gmail.users.settings.sendAs.get({ userId: 'me', sendAsEmail: fromEmail });
      signature = sendAs.data.signature || '';
    } else {
      signature = await getSignature();
    }
  } catch (e) {
    signature = await getSignature();
  }

  let htmlBody = body
    .replace(/\*"([^"]+)"\*/g, '<em>"$1"</em>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  if (signature) {
    htmlBody += '<br><br>--<br>' + signature;
  }

  const headers = [`To: ${to}`];
  if (fromEmail) headers.push(`From: ${fromEmail}`);
  headers.push(`Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8');

  const email = [...headers, '', htmlBody].join('\r\n');
  const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const response = await gmail.users.drafts.update({
    userId: 'me',
    id: draftId,
    requestBody: { message: { raw: encodedEmail } }
  });

  return response.data;
}

/**
 * Delete a Gmail draft
 */
export async function deleteDraft(draftId) {
  const gmail = await getGmailClient();
  await gmail.users.drafts.delete({ userId: 'me', id: draftId });
}

/**
 * Get user's email address (for verification)
 */
export async function getMyEmail() {
  const gmail = await getGmailClient();
  const response = await gmail.users.getProfile({ userId: 'me' });
  return response.data.emailAddress;
}

/**
 * List all send-as addresses (aliases) the user can send from
 */
export async function getSendAsAddresses() {
  const gmail = await getGmailClient();
  const response = await gmail.users.settings.sendAs.list({ userId: 'me' });
  return (response.data.sendAs || []).map(alias => ({
    email: alias.sendAsEmail,
    displayName: alias.displayName || '',
    isDefault: alias.isDefault || false,
    isPrimary: alias.isPrimary || false,
    verificationStatus: alias.verificationStatus
  })).filter(a => a.verificationStatus === 'accepted' || a.isPrimary);
}

/**
 * Find a draft by recipient email and subject (first 30 chars)
 * @param {string} recipientEmail - Email address of the recipient
 * @param {string} subjectSearch - Subject line to search for (matches first 30 chars)
 * @returns {object|null} - Draft object or null if not found
 */
export async function findDraftByRecipientAndSubject(recipientEmail, subjectSearch) {
  const gmail = await getGmailClient();

  // Get all drafts
  const draftsResponse = await gmail.users.drafts.list({
    userId: 'me',
    maxResults: 100
  });

  const drafts = draftsResponse.data.drafts || [];

  // Search through drafts to find matching one
  for (const draft of drafts) {
    const draftDetail = await gmail.users.drafts.get({
      userId: 'me',
      id: draft.id,
      format: 'metadata',
      metadataHeaders: ['To', 'Subject']
    });

    const headers = draftDetail.data.message?.payload?.headers || [];
    const toHeader = headers.find(h => h.name.toLowerCase() === 'to');
    const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');

    const toEmail = toHeader?.value || '';
    const subject = subjectHeader?.value || '';

    // Match recipient email (case-insensitive) and first 30 chars of subject
    const recipientMatch = toEmail.toLowerCase().includes(recipientEmail.toLowerCase());
    const subjectMatch = subject.substring(0, 30) === subjectSearch.substring(0, 30);

    if (recipientMatch && subjectMatch) {
      return {
        id: draft.id,
        to: toEmail,
        subject: subject
      };
    }
  }

  return null;
}

/**
 * Send a draft by its ID
 * @param {string} draftId - The ID of the draft to send
 * @returns {object} - Sent message response
 */
export async function sendDraft(draftId) {
  const gmail = await getGmailClient();

  const response = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: {
      id: draftId
    }
  });

  return response.data;
}

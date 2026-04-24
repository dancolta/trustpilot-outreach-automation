import { google } from 'googleapis';
import { readFileSync } from 'fs';
import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let sheetsClient = null;

/**
 * Initialize Google Sheets API client with service account credentials
 */
async function getClient() {
  if (sheetsClient) return sheetsClient;

  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
  const credentials = JSON.parse(readFileSync(path.resolve(credentialsPath), 'utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Find the first row in Sheet1 where Column A (Channel) is empty
 * @param {number} searchStartRow - Row to start searching from (default: 2 to skip header)
 * @returns {number} Row number of first unprocessed row, or searchStartRow if none found
 */
export async function findFirstUnprocessedRow(searchStartRow = 2) {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Sheet1!A${searchStartRow}:A`,
  });

  const values = response.data.values || [];

  for (let i = 0; i < values.length; i++) {
    const cellValue = (values[i]?.[0] || '').toString().trim().toLowerCase();
    if (!cellValue || cellValue === '') {
      return searchStartRow + i;
    }
  }

  return searchStartRow + values.length;
}

/**
 * Read all leads from Sheet1 including status column
 * Returns full lead data for display in UI
 */
export async function readAllLeads(startRow = 2) {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // A=Status, B=First Name, C=Last Name, D=Company, E=Email, F=Website, G=Trustpilot URL, H=Email Draft, I=Draft ID
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Sheet1!A${startRow}:I`,
  });

  const rows = response.data.values || [];

  return rows
    .map((row, index) => ({
      status: (row[0] || '').trim(),
      firstName: (row[1] || '').trim(),
      lastName: (row[2] || '').trim(),
      company: (row[3] || '').trim(),
      email: (row[4] || '').trim(),
      website: (row[5] || '').trim(),
      trustpilotUrl: (row[6] || '').trim(),
      emailDraft: (row[7] || '').trim(),
      draftId: (row[8] || '').trim(),
      rowNumber: startRow + index,
    }))
    .filter(row => row.company);
}

/**
 * Read companies from Sheet1 starting from a specific row
 * Compact layout: A=Status, B=First Name, C=Last Name, D=Company, E=Email, F=Website
 */
export async function readCompanies(startRow = 2, limit = null) {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // If limit specified, only fetch those rows
  const endRow = limit ? startRow + limit - 1 : '';
  const range = limit ? `Sheet1!A${startRow}:F${endRow}` : `Sheet1!A${startRow}:F`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values || [];

  return rows
    .map((row, index) => ({
      ceoName: `${row[1] || ''} ${row[2] || ''}`.trim(),
      company: row[3]?.trim() || '',
      email: row[4]?.trim() || '',
      website: row[5]?.trim() || '',
      rowNumber: startRow + index,
    }))
    .filter(row => row.company);
}

/**
 * Mark a row as processed by setting Column A (Status)
 */
export async function markAsProcessed(rowNumber, status = 'email') {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Sheet1!A${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status]] }
  });
}

/**
 * Write draft data to Sheet1 columns G-I (Trustpilot URL, Email Draft, Draft ID)
 */
export async function writeDraftToLead(rowNumber, { trustpilotUrl, emailDraft, draftId }) {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Sheet1!G${rowNumber}:I${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[trustpilotUrl || '', emailDraft || '', draftId || '']] }
  });
}

/**
 * Ensure the "Emails" tab exists with proper headers and formatting
 */
let emailsTabName = null;
let emailsSheetId = null;

async function ensureEmailsTab() {
  if (emailsTabName) return { tabName: emailsTabName, sheetId: emailsSheetId };

  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = spreadsheet.data.sheets.find(
    s => s.properties.title.toLowerCase() === 'emails'
  );

  if (existingSheet) {
    emailsTabName = existingSheet.properties.title;
    emailsSheetId = existingSheet.properties.sheetId;
    return { tabName: emailsTabName, sheetId: emailsSheetId };
  }

  // Create new tab
  const createResponse = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: { title: 'Emails' }
        }
      }]
    }
  });

  emailsSheetId = createResponse.data.replies[0].addSheet.properties.sheetId;
  emailsTabName = 'Emails';

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Emails!A1:H1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Company', 'CEO Name', 'CEO Email', 'Trustpilot Link', 'Pain Points', 'Email Draft', 'Status', 'Scheduled Time']]
    }
  });

  // Format the new sheet
  await formatEmailsSheet(sheets, spreadsheetId, emailsSheetId);

  return { tabName: emailsTabName, sheetId: emailsSheetId };
}

/**
 * Apply formatting to the Emails sheet - clean modern table style
 */
async function formatEmailsSheet(sheets, spreadsheetId, sheetId) {
  const borderStyle = {
    style: 'SOLID',
    width: 1,
    color: { red: 0.85, green: 0.85, blue: 0.85 }
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Freeze header row
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        },
        // Header formatting - clean blue gradient
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.26, green: 0.52, blue: 0.96 }, // Google blue
                textFormat: {
                  bold: true,
                  fontSize: 11,
                  foregroundColor: { red: 1, green: 1, blue: 1 }
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                padding: { top: 8, bottom: 8, left: 8, right: 8 }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)'
          }
        },
        // Data cells - text wrap and padding
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                wrapStrategy: 'WRAP',
                verticalAlignment: 'TOP',
                textFormat: { fontSize: 10 },
                padding: { top: 6, bottom: 6, left: 8, right: 8 }
              }
            },
            fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,textFormat,padding)'
          }
        },
        // Add borders to entire table area
        {
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 8 },
            top: borderStyle,
            bottom: borderStyle,
            left: borderStyle,
            right: borderStyle,
            innerHorizontal: borderStyle,
            innerVertical: borderStyle
          }
        },
        // Header bottom border - thicker
        {
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
            bottom: { style: 'SOLID', width: 2, color: { red: 0.2, green: 0.4, blue: 0.8 } }
          }
        },
        // Column widths
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 280 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 450 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } },
        // Header row height
        { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
      ]
    }
  });
}

/**
 * Apply formatting to existing emails sheet (for refresh)
 */
export async function refreshSheetFormatting() {
  const { sheetId } = await ensureEmailsTab();
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await formatEmailsSheet(sheets, spreadsheetId, sheetId);
}

/**
 * Write outreach data to the "Emails" tab
 */
export async function writeOutreach(data) {
  const { tabName, sheetId } = await ensureEmailsTab();

  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Check if company already exists
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:A`,
  });

  const existingCompanies = (existing.data.values || []).flat();
  const rowIndex = existingCompanies.findIndex(c => c === data.company);

  // Serialize generated email to JSON string if it's an object (A/B variants)
  const emailValue = typeof data.generatedEmail === 'object'
    ? JSON.stringify(data.generatedEmail)
    : (data.generatedEmail || '');

  const rowData = [
    data.company,
    data.ceoName,
    data.ceoEmail || '',
    data.trustpilotUrl || '',
    data.painPoints,
    emailValue,
    data.status
  ];

  let targetRow;

  if (rowIndex > 0) {
    targetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A${targetRow}:G${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] }
    });
  } else {
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tabName}'!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowData] }
    });

    // Extract the row number from the response
    const updatedRange = appendResponse.data.updates.updatedRange;
    const match = updatedRange.match(/!A(\d+):/);
    targetRow = match ? parseInt(match[1]) : null;
  }

  // Apply row formatting (text wrap, alternating colors)
  if (targetRow && sheetId) {
    const isEvenRow = targetRow % 2 === 0;

    // Subtle zebra stripe colors
    const rowBgColor = isEvenRow
      ? { red: 0.97, green: 0.98, blue: 1 }      // Very light blue
      : { red: 1, green: 1, blue: 1 };           // White

    // Status colors - clean and modern
    let statusColor;
    if (data.status.includes('Ready')) {
      statusColor = { red: 0.85, green: 0.94, blue: 0.85 };  // Soft green
    } else if (data.status.includes('Failed')) {
      statusColor = { red: 0.96, green: 0.8, blue: 0.8 };    // Soft red
    } else if (data.status.includes('Skipped')) {
      statusColor = { red: 1, green: 0.95, blue: 0.8 };      // Soft yellow
    } else {
      statusColor = rowBgColor;
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Row formatting
          {
            repeatCell: {
              range: { sheetId, startRowIndex: targetRow - 1, endRowIndex: targetRow, startColumnIndex: 0, endColumnIndex: 6 },
              cell: {
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  verticalAlignment: 'TOP',
                  backgroundColor: rowBgColor,
                  textFormat: { fontSize: 10 },
                  padding: { top: 6, bottom: 6, left: 8, right: 8 }
                }
              },
              fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,backgroundColor,textFormat,padding)'
            }
          },
          // Status column formatting
          {
            repeatCell: {
              range: { sheetId, startRowIndex: targetRow - 1, endRowIndex: targetRow, startColumnIndex: 6, endColumnIndex: 7 },
              cell: {
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  verticalAlignment: 'MIDDLE',
                  horizontalAlignment: 'CENTER',
                  backgroundColor: statusColor,
                  textFormat: { fontSize: 10, bold: true },
                  padding: { top: 6, bottom: 6, left: 4, right: 4 }
                }
              },
              fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,backgroundColor,textFormat,padding)'
            }
          }
        ]
      }
    });
  }
}

/**
 * Update status for a company in the Emails tab
 */
export async function updateStatus(company, status) {
  const { tabName } = await ensureEmailsTab();
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:A`,
  });

  const existingCompanies = (existing.data.values || []).flat();
  const rowIndex = existingCompanies.findIndex(c => c === company);

  if (rowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!G${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] }
    });
  }
}

/**
 * Get a specific row from the Emails tab
 */
export async function getEmailRow(rowNumber) {
  const { tabName } = await ensureEmailsTab();
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A${rowNumber}:G${rowNumber}`,
  });

  const row = response.data.values?.[0];
  if (!row) return null;

  return {
    company: row[0] || '',
    ceoName: row[1] || '',
    ceoEmail: row[2] || '',
    trustpilotUrl: row[3] || '',
    painPoints: row[4] || '',
    email: row[5] || '',
    status: row[6] || '',
    rowNumber
  };
}

/**
 * Update the scheduled time for a company's email
 */
export async function updateScheduledTime(company, scheduledTime, timezone) {
  const { tabName, sheetId } = await ensureEmailsTab();
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Find the row for this company
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:A`,
  });

  const existingCompanies = (existing.data.values || []).flat();
  const rowIndex = existingCompanies.findIndex(c => c === company);

  if (rowIndex > 0) {
    // Format the scheduled time for display
    const scheduledDate = new Date(scheduledTime);
    const formattedTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(scheduledDate);

    // First, check if column H exists (Scheduled Time), if not we'll add the header
    const headers = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:H1`,
    });

    const headerRow = headers.data.values?.[0] || [];
    if (headerRow.length < 8 || headerRow[7] !== 'Scheduled Time') {
      // Add the header for column H
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!H1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Scheduled Time']] }
      });
    }

    // Update the scheduled time in column H
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!H${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[formattedTime]] }
    });
  }
}

/**
 * Clear the scheduled time for a company's email (used when cancelling)
 */
export async function clearScheduledTime(company) {
  const { tabName } = await ensureEmailsTab();
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Find the row for this company
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:A`,
  });

  const existingCompanies = (existing.data.values || []).flat();
  const rowIndex = existingCompanies.findIndex(c => c === company);

  if (rowIndex > 0) {
    // Clear the scheduled time in column H
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!H${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['']] }
    });
  }
}

/**
 * Clear all lead rows from Sheet1 (A2:I), used before a replace-mode import
 * @returns {number} Number of rows cleared
 */
export async function clearLeadsFromSheet() {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Get the last row to know the range to clear
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A2:I',
  });
  const rowCount = (response.data.values || []).length;
  if (rowCount === 0) return 0;

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `Sheet1!A2:I${rowCount + 1}`,
  });
  return rowCount;
}

export async function appendLeadsToSheet(leads) {
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const rows = leads.map(l => [
    '',                   // A: Status (empty = unprocessed)
    l.firstName || '',    // B: First Name
    l.lastName || '',     // C: Last Name
    l.company || '',      // D: Company
    l.email || '',        // E: Email
    l.website || '',      // F: Website
    '',                   // G: Trustpilot URL (filled during processing)
    '',                   // H: Email Draft (filled during processing)
    '',                   // I: Draft ID (filled during processing)
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:I',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  return rows.length;
}

export async function getAllEmails() {
  const { tabName } = await ensureEmailsTab();
  const sheets = await getClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:H`,
  });

  const rows = response.data.values || [];
  return rows.map((row, index) => ({
    company: (row[0] || '').trim(),
    ceoName: (row[1] || '').trim(),
    ceoEmail: (row[2] || '').trim(),
    trustpilotUrl: (row[3] || '').trim(),
    painPoints: (row[4] || '').trim(),
    email: (row[5] || '').trim(),
    status: (row[6] || '').trim(),
    scheduledTime: (row[7] || '').trim(),
    rowNumber: index + 2
  })).filter(row => row.company && row.email);
}

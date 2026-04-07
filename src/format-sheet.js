#!/usr/bin/env node
import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import path from 'path';

const credentials = JSON.parse(readFileSync(path.resolve('./credentials.json'), 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

async function formatSheet() {
  console.log('Formatting Emails sheet...\n');

  // Get sheet info
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const emailsSheet = spreadsheet.data.sheets.find(s => s.properties.title.toLowerCase() === 'emails');

  if (!emailsSheet) {
    console.log('No "Emails" tab found.');
    return;
  }

  const sheetId = emailsSheet.properties.sheetId;
  const tabName = emailsSheet.properties.title;
  console.log(`Found tab: "${tabName}" (ID: ${sheetId})`);

  // Get current data to know how many rows
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:G`,
  });

  const rowCount = data.data.values?.length || 1;
  console.log(`Rows with data: ${rowCount}`);

  // Update headers
  console.log('Setting headers...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Company', 'CEO Name', 'CEO Email', 'Trustpilot URL', 'Pain Points', 'Email Draft', 'Status']]
    }
  });

  const borderStyle = {
    style: 'SOLID',
    width: 1,
    color: { red: 0.82, green: 0.82, blue: 0.82 }
  };

  console.log('Applying table formatting...');
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
        // Header styling - modern blue
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.26, green: 0.52, blue: 0.96 },
                textFormat: {
                  bold: true,
                  fontSize: 11,
                  foregroundColor: { red: 1, green: 1, blue: 1 }
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                padding: { top: 10, bottom: 10, left: 8, right: 8 }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)'
          }
        },
        // Data cells default styling
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 7 },
            cell: {
              userEnteredFormat: {
                wrapStrategy: 'WRAP',
                verticalAlignment: 'TOP',
                textFormat: { fontSize: 10 },
                padding: { top: 8, bottom: 8, left: 8, right: 8 }
              }
            },
            fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,textFormat,padding)'
          }
        },
        // Table borders
        {
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 7 },
            top: borderStyle,
            bottom: borderStyle,
            left: borderStyle,
            right: borderStyle,
            innerHorizontal: borderStyle,
            innerVertical: borderStyle
          }
        },
        // Header bottom border - accent
        {
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
            bottom: { style: 'SOLID', width: 2, color: { red: 0.15, green: 0.35, blue: 0.7 } }
          }
        },
        // Column widths
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 300 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 420 }, fields: 'pixelSize' } },
        { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
        // Header row height
        { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
      ]
    }
  });

  // Apply alternating row colors for data rows
  console.log('Applying zebra stripes...');
  for (let i = 1; i < rowCount; i++) {
    const isEven = i % 2 === 0;
    const bgColor = isEven
      ? { red: 0.96, green: 0.98, blue: 1 }
      : { red: 1, green: 1, blue: 1 };

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 6 },
            cell: {
              userEnteredFormat: { backgroundColor: bgColor }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        }]
      }
    });
  }

  // Color status cells based on content
  console.log('Coloring status cells...');
  const values = data.data.values || [];
  for (let i = 1; i < values.length; i++) {
    const status = values[i]?.[6] || '';
    let statusColor;

    if (status.includes('Ready')) {
      statusColor = { red: 0.85, green: 0.94, blue: 0.85 };
    } else if (status.includes('Failed')) {
      statusColor = { red: 0.96, green: 0.8, blue: 0.8 };
    } else if (status.includes('Skipped')) {
      statusColor = { red: 1, green: 0.95, blue: 0.8 };
    } else {
      continue;
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: { sheetId, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 6, endColumnIndex: 7 },
            cell: {
              userEnteredFormat: {
                backgroundColor: statusColor,
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                textFormat: { bold: true, fontSize: 10 }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)'
          }
        }]
      }
    });
  }

  console.log('\n✓ Sheet formatted successfully!');
}

formatSheet().catch(console.error);

import { google } from 'googleapis';

class GoogleSheetsService {
  constructor() {
    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    this.sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || 'Sheet1';

    if (!clientEmail || !privateKeyRaw || !this.spreadsheetId) {
      console.warn('⚠️ [GoogleSheets] Missing one or more env vars: GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, GOOGLE_SHEETS_SPREADSHEET_ID');
      this.enabled = false;
      return;
    }

    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

    this.jwt = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.jwt });
    this.enabled = true;
  }

  isEnabled() {
    return this.enabled === true;
  }

  async appendRow(values) {
    if (!this.isEnabled()) {
      console.warn('⚠️ [GoogleSheets] Service not enabled. Skipping append.');
      return;
    }

    // First, find the last non-empty row to append after any dropdown blocks
    const meta = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A:A`,
      majorDimension: 'ROWS'
    });

    const rows = meta?.data?.values ? meta.data.values.length : 0;
    const nextRow = rows + 1; // append after existing values

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A${nextRow}:Z${nextRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  }
}

export default new GoogleSheetsService();



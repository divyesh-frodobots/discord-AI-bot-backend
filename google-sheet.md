# Google Sheets Integration (via Service Account)

This project uses **Google Sheets API** with a **Google Cloud Service Account** for secure access to a Google Sheet.

---

## 📌 Prerequisites

- A Google Cloud project
- Google Sheets API enabled
- Service Account created
- Service Account email shared as **Editor** on the target Google Sheet

---

## ⚙️ Setup Steps

### 1. Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Sheets Integration`).

### 2. Enable Google Sheets API
1. In the project, navigate to **APIs & Services → Library**.
2. Search for **Google Sheets API**.
3. Click **Enable**.

### 3. Create Service Account
1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → Service Account**.
3. Name it (e.g., `sheets-service-account`).
4. Click **Done** (no roles required for Sheets API).

### 4. Generate JSON Key
1. Open the Service Account you created.
2. Go to the **Keys** tab → **Add Key → Create New Key**.
3. Select **JSON** → download the file → keep it safe.
4. From the JSON file, note:
   - `client_email`
   - `private_key`

### 5. Share Google Sheet
1. Open your target Google Sheet.
2. Click **Share**.
3. Add your Service Account email (from JSON `client_email`) with **Editor** access.

### 6. Configure Environment Variables
Edit your `.env` file:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=<your_sheet_id>   # from Google Sheets URL
GOOGLE_SHEETS_SHEET_NAME=Sheet1                # tab name inside Sheet
GOOGLE_SHEETS_CLIENT_EMAIL=<service-account-email>
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nABC123...\n-----END PRIVATE KEY-----\n"

const { google } = require('googleapis');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey || !process.env.SPREADSHEET_ID) {
    console.error('[Sheets] Missing required env vars:', {
      hasEmail: !!email,
      hasKey: !!privateKey,
      hasSheetId: !!process.env.SPREADSHEET_ID
    });
    return null;
  }

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

function parseRowDateTime(rawDate, rawTime) {
  if (!rawDate) return null;

  let dateStr = rawDate.toString().trim();

  const nowIST = new Date(Date.now() + IST_OFFSET_MS);
  if (!/\b(20\d\d)\b/.test(dateStr)) {
    dateStr += ` ${nowIST.getUTCFullYear()}`;
  }

  const rowDateObj = new Date(dateStr + ' UTC');
  if (isNaN(rowDateObj.getTime())) return null;

  let hr = 0, min = 0;

  if (rawTime) {
    const rawTimeStr = rawTime.toString().trim();
    const tObj = new Date(rawTime);

    if (!isNaN(tObj.getTime()) && rawTimeStr.includes('T')) {
      hr = tObj.getUTCHours();
      min = tObj.getUTCMinutes();
    } else {
      const match = rawTimeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
      if (match) {
        hr = parseInt(match[1], 10);
        min = match[2] ? parseInt(match[2], 10) : 0;
        const ampm = match[3] ? match[3].toLowerCase() : '';
        if (ampm === 'pm' && hr < 12) hr += 12;
        if (ampm === 'am' && hr === 12) hr = 0;
      }
    }
  }

  rowDateObj.setUTCHours(hr, min, 0, 0);
  const utcEpoch = rowDateObj.getTime() - IST_OFFSET_MS;
  return new Date(utcEpoch);
}

function getCalendarDateFromLogInTime(logInTimeStr) {
  if (!logInTimeStr) return null;
  const d = new Date(logInTimeStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function driveLinkToImageUrl(webViewLink) {
  if (!webViewLink) return '';
  const match = webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return webViewLink;
  const fileId = match[1];
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

module.exports = {
  IST_OFFSET_MS,
  getSheetsClient,
  parseRowDateTime,
  getCalendarDateFromLogInTime,
  driveLinkToImageUrl
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;


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


function driveLinkToImageUrl(webViewLink) {
  if (!webViewLink) return '';
  const match = webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return webViewLink;
  const fileId = match[1];
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

module.exports = {
  IST_OFFSET_MS,
  parseRowDateTime,
  driveLinkToImageUrl
};

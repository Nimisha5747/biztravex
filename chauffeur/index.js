require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieSession = require('cookie-session');
const mongoose = require('mongoose');
const { google } = require('googleapis');
const multer = require('multer');
const stream = require('stream');
const Chauffeur = require('./models/Chauffeur');
const Shift = require('./models/Shift');
const { router: adminRouter } = require('./routes/admin');

const { IST_OFFSET_MS, getSheetsClient, parseRowDateTime, getCalendarDateFromLogInTime } = require('./utils/sheetsHelpers');

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: 'biztravex_session',
    keys: [process.env.SESSION_SECRET || 'biztravex_default_secret_key'],
    maxAge: 13 * 60 * 60 * 1000, // 24 hours
  })
);

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Admin panel routes (separate session, separate auth) — must be registered
// before the catch-all route at the bottom of this file.
app.use('/api/admin', adminRouter);

// Connect to MongoDB chauffeur database
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/chauffeur';
let isMongoConnected = false;

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    isMongoConnected = true;
    console.log('Successfully connected to MongoDB database: chauffeur (collection: credentials)');
  })
  .catch((err) => {
    console.warn('MongoDB connection notice:', err.message, '- Server running with fallback auth mode.');
  });

// In-memory mock database for fallback testing if MongoDB is not running locally
const inMemoryChauffeurs = [
  { name: 'John Doe', number: '9876543210' },
  { name: 'Alex Smith', number: '9123456789' },
  { name: 'Michael Brown', number: '9988776655' },
];

// // Helper: Initialize Google Sheets API client
// function getSheetsClient() {
//   const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
//   let privateKey = process.env.GOOGLE_PRIVATE_KEY;

//   if (!email || !privateKey || !process.env.SPREADSHEET_ID) {
//     console.error('[Sheets] Missing required env vars:', {
//       hasEmail: !!email,
//       hasKey: !!privateKey,
//       hasSheetId: !!process.env.SPREADSHEET_ID
//     });
//     return null;
//   }

//   if (privateKey) {
//     privateKey = privateKey.replace(/\\n/g, '\n');
//   }

//   const auth = new google.auth.JWT({
//     email,
//     key: privateKey,
//     scopes: ['https://www.googleapis.com/auth/spreadsheets'],
//   });

//   return google.sheets({ version: 'v4', auth });
// }

function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) return null;
  if (privateKey) privateKey = privateKey.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  return google.drive({ version: 'v3', auth });
}


// Helper: Calculate shift boundaries
function getShiftBounds(shiftStr) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime());

  if (shiftStr === "12 am - 12 pm") {
    start.setHours(0, 0, 0, 0);
    end.setHours(11, 59, 59, 999);
  } else if (shiftStr === "12 pm - 12 am") {
    start.setHours(12, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (shiftStr === "6 am - 6 pm") {
    start.setHours(6, 0, 0, 0);
    end.setHours(17, 59, 59, 999);
  } else if (shiftStr === "6 pm - 6 am") {
    start.setDate(start.getDate() - 1); // yesterday
    end.setDate(end.getDate());
    start.setHours(18, 0, 0, 0);
    end.setHours(5, 59, 59, 999);
  }

  return { start, end };
}

// function parseRowDateTime(rawDate, rawTime) {
//   if (!rawDate) return null;

//   let dateStr = rawDate.toString().trim();

//   // If the date string does NOT contain a 4-digit year (like "21 July"), append current IST year
//   // Use IST "now" to determine the correct year near midnight boundaries
//   const nowIST = new Date(Date.now() + IST_OFFSET_MS);
//   if (!/\b(20\d\d)\b/.test(dateStr)) {
//     dateStr += ` ${nowIST.getUTCFullYear()}`;
//   }

//   // Parse the date string as a UTC midnight value first (it represents a local IST date)
//   const rowDateObj = new Date(dateStr + ' UTC');
//   if (isNaN(rowDateObj.getTime())) return null;

//   let hr = 0, min = 0;

//   if (rawTime) {
//     const rawTimeStr = rawTime.toString().trim();
//     const tObj = new Date(rawTime);

//     // Case A: ISO Date String from Google Sheets (e.g. "1899-12-30T20:00:00.000Z")
//     // Google Sheets stores time-of-day as UTC hours in this serial date format,
//     // and those hours already represent the local (IST) time the user typed.
//     if (!isNaN(tObj.getTime()) && rawTimeStr.includes('T')) {
//       hr = tObj.getUTCHours();   // ✅ Correct — Sheets serial dates encode local time in UTC field
//       min = tObj.getUTCMinutes();
//     } else {
//       // Case B: Text string like "8:00 PM" or "20:00 or "8:00:00 PM" " — these are already IST local time values
//       const match = rawTimeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
//       if (match) {
//         hr = parseInt(match[1], 10);
//         min = match[2] ? parseInt(match[2], 10) : 0;
//         const ampm = match[3] ? match[3].toLowerCase() : '';
//         if (ampm === 'pm' && hr < 12) hr += 12;
//         if (ampm === 'am' && hr === 12) hr = 0;
//       }
//     }
//   }

//   // The date string represents a date in IST. We parsed it as UTC midnight.
//   // Now set the IST hours/minutes on that UTC-midnight date.
//   // Then subtract IST_OFFSET to get the true UTC epoch for this IST date+time.
//   // 
//   // Example: "21 July 2026" parsed as UTC = 2026-07-21T00:00:00Z (midnight UTC)
//   //          IST time = 20:00 (8 PM IST)
//   //          True UTC epoch = 2026-07-21T00:00:00Z + 20h - 5.5h = 2026-07-21T14:30:00Z ✅
//   rowDateObj.setUTCHours(hr, min, 0, 0);
//   const utcEpoch = rowDateObj.getTime() - IST_OFFSET_MS;
//   return new Date(utcEpoch);
// }

// ================= AUTHENTICATION ROUTES (MongoDB) =================

// Register a new chauffeur in MongoDB
app.post('/api/auth/register', async (req, res) => {
  const { name, number } = req.body;

  if (!name || !number) {
    return res.status(400).json({ error: 'Please provide both Name and Mobile Number.' });
  }

  const cleanName = name.trim();
  const cleanNumber = number.trim();

  try {
    if (isMongoConnected) {
      const existing = await Chauffeur.findOne({ number: cleanNumber });
      if (existing) {
        return res.status(400).json({ error: 'Mobile number already registered. Please log in.' });
      }

      await Chauffeur.create({ name: cleanName, number: cleanNumber });
    } else {
      // In-memory fallback
      const existing = inMemoryChauffeurs.find((c) => c.number === cleanNumber);
      if (existing) {
        return res.status(400).json({ error: 'Mobile number already registered. Please log in.' });
      }
      inMemoryChauffeurs.push({ name: cleanName, number: cleanNumber });
    }

    res.json({ success: true, message: 'Account created successfully! You can now log in.' });
  } catch (error) {
    console.error('Error registering chauffeur:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login chauffeur by validating against MongoDB credentials
app.post('/api/auth/login', async (req, res) => {
  const { name, number, shift } = req.body;

  if (!name || !number) {
    return res.status(400).json({ error: 'Please enter Name and Mobile Number.' });
  }

  const cleanName = name.trim();
  const cleanNumber = number.trim();

  try {
    let foundChauffeur = null;

    if (isMongoConnected) {
      foundChauffeur = await Chauffeur.findOne({ number: cleanNumber });
    } else {
      foundChauffeur = inMemoryChauffeurs.find((c) => c.number === cleanNumber);
    }

    if (!foundChauffeur) {
      return res.status(401).json({
        error: 'No account found matching this mobile number. Please click "Create an Account" first.',
      });
    }

    // Set session
    req.session.chauffeur = {
      name: foundChauffeur.name,
      number: foundChauffeur.number,
      shift: '',
    };

    res.json({ success: true, chauffeur: req.session.chauffeur });
  } catch (error) {
    console.error('Error logging in chauffeur:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get currently logged in chauffeur session details
app.get('/api/me', (req, res) => {
  res.json({
    loggedIn: !!req.session.chauffeur,
    chauffeur: req.session.chauffeur || null,
  });
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ================= PUNCH IN & PUNCH OUT ROUTES (Google Sheets API) =================

// Endpoint: Fetch assigned bookings for today's shift within a 14-hour window
app.get('/api/bookings/shift-window', async (req, res) => {
  const { startTime, name } = req.query;

  if (!startTime || !name) {
    return res.status(400).json({ error: 'Missing startTime or chauffeur name.' });
  }

  const cleanUserName = name.trim().toLowerCase();

  try {
    const sheets = getSheetsClient();
    if (!sheets) {
      return res.status(503).json({ error: 'Booking data source is not configured. Contact admin.' });
    }

    let masterRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `'Master-sheet'!A1:Z5000`,
      });
      masterRows = response.data.values || [];
    } catch (err) {
      console.error('Error fetching Master-sheet:', err);
    }

    const NAME_COLUMN_INDEX = 11; // Column L
    const DATE_COLUMN_INDEX = 16;   // Column Q
    const PICKUP_TIME_INDEX = 17;   // Column R
    const CUSTOMER_NAME_INDEX = 2; // Column C

    // startTime is a local IST string from the chauffeur's phone (e.g. "7/25/2026, 8:00:00 PM").
    // new Date() will parse it as local time on the server — on Vercel (UTC server) that's wrong.
    // Instead, parse it manually as IST by converting to UTC epoch.
    const parsedRaw = new Date(`${startTime} UTC`);
    if (isNaN(parsedRaw.getTime())) {
      return res.status(400).json({ error: 'Invalid startTime format.' });
    }
    // parsedRaw.getTime() is: epoch that JavaScript inferred, which on UTC server = UTC epoch
    // But the string "8:00 PM" meant IST. So subtract IST offset to get true UTC epoch.
    // However, new Date("7/25/2026, 8:00:00 PM") in UTC already reads it as UTC 8 PM.
    // We need it to represent IST 8 PM = UTC 2:30 PM.
    // So: shiftStart = parsedRaw - IST_OFFSET_MS (since parsedRaw is 5:30h too late)
    const shiftStart = new Date(parsedRaw.getTime() - IST_OFFSET_MS);
    if (isNaN(shiftStart.getTime())) {
      return res.status(400).json({ error: 'Invalid startTime format.' });
    }

    // 14 hour window logic! Crossing midnight is naturally handled by epoch time.
    // Allow a 12-hour grace period backwards so chauffeurs can see bookings from earlier in the day
    const shiftStartWindow = shiftStart;
    const shiftEnd = new Date(shiftStart.getTime() + 14 * 60 * 60 * 1000);

    const assignedBookings = [];

    for (let i = 1; i < masterRows.length; i++) {
      const rowNameRaw = masterRows[i][NAME_COLUMN_INDEX] ? masterRows[i][NAME_COLUMN_INDEX].toString().trim().toLowerCase() : '';

      if (rowNameRaw && rowNameRaw === cleanUserName) {
        const bookingId = masterRows[i][1] ? masterRows[i][1].toString().trim() : '';
        if (!bookingId) continue;

        const rawDate = masterRows[i][DATE_COLUMN_INDEX];
        const rawTime = masterRows[i][PICKUP_TIME_INDEX];
        const rowDateTime = parseRowDateTime(rawDate, rawTime);

        if (rowDateTime && rowDateTime >= shiftStartWindow && rowDateTime <= shiftEnd) {
          const customerName = masterRows[i][CUSTOMER_NAME_INDEX] ? masterRows[i][CUSTOMER_NAME_INDEX].toString().trim() : 'Unknown';
          assignedBookings.push({ bookingId, customerName });
        }
      }
    }

    console.log(`[Shift Window] Name: ${name} | Start: ${shiftStart.toLocaleString()} | Found:`, assignedBookings);

    res.json({ bookings: assignedBookings });
  } catch (error) {
    console.error('Error fetching shift-window bookings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Punch In Submit (Pre-shift checklist for selected booking ID)
app.post('/api/punch-in', async (req, res) => {
  const { bookingId, carCleaned, phoneCharged, enoughPetrol, chauffeur } = req.body;
  const name = chauffeur ? chauffeur.name : (req.session.chauffeur ? req.session.chauffeur.name : 'Unknown');
  const number = chauffeur ? chauffeur.number : (req.session.chauffeur ? req.session.chauffeur.number : '');

  if (!bookingId) {
    return res.status(400).json({ error: 'Please select a Booking ID for Punch In.' });
  }

  try {
    const cleanUserMobile = number.replace(/\D/g, '').slice(-9);

    // Find the latest Shift where chauffeur's number ends with cleanUserMobile and contains the bookingId
    const shift = await Shift.findOne({
      "chauffeur.number": { $regex: cleanUserMobile + '$' },
      "bookings.bookingId": bookingId
    }).sort({ createdAt: -1 });

    if (shift) {
      // Find the booking sub-document and update it
      const booking = shift.bookings.find(b => b.bookingId === bookingId);
      if (booking) {
        booking.carCleaned = carCleaned || '';
        booking.phoneCharged = phoneCharged || '';
        booking.enoughPetrol = enoughPetrol || '';
        await shift.save();
      }
    } else {
      // No matching shift/booking found (fallback) — create a new shift response
      const options = { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
      const localTime = new Date().toLocaleString('en-US', options);
      const dateStr = getCalendarDateFromLogInTime(localTime);

      await Shift.create({
        chauffeur: { name, number },
        bookings: [{
          bookingId,
          carCleaned: carCleaned || '',
          phoneCharged: phoneCharged || '',
          enoughPetrol: enoughPetrol || ''
        }],
        dateStr
      });
    }

    res.json({ success: true, message: `Punch In successfully recorded for Booking ${bookingId}!` });
  } catch (error) {
    console.error('Error during Punch In submit:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Punch Out Submit (Ride completion report for selected booking IDs)
app.post('/api/punch-out', async (req, res) => {
  const { bookings, clientTimestamp, chauffeur } = req.body;
  const name = chauffeur ? chauffeur.name : (req.session.chauffeur ? req.session.chauffeur.name : 'Unknown');
  const number = chauffeur ? chauffeur.number : (req.session.chauffeur ? req.session.chauffeur.number : '');

  if (!name || !number) {
    return res.status(401).json({ error: 'Please log in first.' });
  }

  if (!bookings || bookings.length === 0) {
    return res.status(400).json({ error: 'No booking punch in forms submitted.' });
  }

  try {
    const cleanUserMobile = number.replace(/\D/g, '').slice(-9);

    for (let i = 0; i < bookings.length; i++) {
      const b = bookings[i];

      // Find matching shift
      const shift = await Shift.findOne({
        "chauffeur.number": { $regex: cleanUserMobile + '$' },
        "bookings.bookingId": b.bookingId
      }).sort({ createdAt: -1 });

      if (shift) {
        const booking = shift.bookings.find(bk => bk.bookingId === b.bookingId);
        if (booking) {
          booking.status = b.status || '';
          booking.customerName = b.customerName || '';
          booking.guestDetails = b.guestDetails || '';
          booking.luggageDetails = b.luggageDetails || '';
          booking.operationalIssues = b.operationalIssues || '';
          booking.checkboxAnswers = b.checkboxAnswers || '';
          booking.issueDescription = b.issueDescription || '';
          booking.guestFeedbackOptions = b.guestFeedbackOptions || '';
          booking.guestFeedbackText = b.guestFeedbackText || '';
          booking.remarks = b.remarks || '';
          await shift.save();
        }
      } else {
        // Fallback: Create a new shift response with this single booking
        const options = { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
        const localTime = clientTimestamp || new Date().toLocaleString('en-US', options);
        const dateStr = getCalendarDateFromLogInTime(localTime);

        await Shift.create({
          chauffeur: { name, number },
          bookings: [{
            bookingId: b.bookingId || '',
            status: b.status || '',
            customerName: b.customerName || '',
            guestDetails: b.guestDetails || '',
            luggageDetails: b.luggageDetails || '',
            operationalIssues: b.operationalIssues || '',
            checkboxAnswers: b.checkboxAnswers || '',
            issueDescription: b.issueDescription || '',
            guestFeedbackOptions: b.guestFeedbackOptions || '',
            guestFeedbackText: b.guestFeedbackText || '',
            remarks: b.remarks || ''
          }],
          dateStr
        });
      }
    }

    res.json({ success: true, message: 'Punch Out submitted successfully!' });
  } catch (error) {
    console.error('Error during Punch Out submit:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 1: Start Shift (Appends shift start row to Form Responses 1)
app.post('/api/shift/start', upload.array('readinessImages', 10), async (req, res) => {
  const { clientTimestamp, vrClean, vrAmenities, vrReady } = req.body;
  const files = req.files || [];

  let chauffeur = null;
  let assignedBookings = [];
  try {
    chauffeur = req.body.chauffeur ? JSON.parse(req.body.chauffeur) : null;
    assignedBookings = req.body.assignedBookings ? JSON.parse(req.body.assignedBookings) : [];
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request format.' });
  }

  const name = chauffeur ? chauffeur.name : (req.session.chauffeur ? req.session.chauffeur.name : null);
  const number = chauffeur ? chauffeur.number : (req.session.chauffeur ? req.session.chauffeur.number : null);

  if (!name || !number) {
    return res.status(401).json({ error: 'Please log in first.' });
  }

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'At least one vehicle readiness photo is required.' });
  }

  try {
    const options = { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
    const localTime = clientTimestamp || new Date().toLocaleString('en-US', options);

    // Upload each readiness photo to the SAME Drive folder used for end-shift
    // photos, distinguished only by filename prefix + index. Collect all links.
    let readinessImageLinks = [];
    const webAppUrl = process.env.APPS_SCRIPT_WEB_APP_URL;
    if (webAppUrl) {
      const d = new Date();
      const dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const driveFileName = `vehicle_readiness_${i + 1}_${name || 'Unknown'}_${dateStr}.jpg`;
          const base64Image = file.buffer.toString('base64');

          const fetchRes = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64: base64Image,
              fileName: driveFileName,
              mimeType: file.mimetype
            })
          });

          const result = await fetchRes.json();
          if (result.success) {
            readinessImageLinks.push(result.webViewLink);
          } else {
            console.error(`Readiness photo ${i + 1} upload failed:`, result.error);
          }
        } catch (uploadErr) {
          console.error(`Error uploading readiness photo ${i + 1}:`, uploadErr);
        }
      }
    } else {
      console.warn('APPS_SCRIPT_WEB_APP_URL not set — skipping readiness photo upload.');
    }

    const readinessImageLink = readinessImageLinks.join('\n'); // multiple links stacked in one cell

    const dateStr = getCalendarDateFromLogInTime(localTime);

    const shift = await Shift.create({
      chauffeur: { name, number },
      logInTime: localTime,
      vrClean: vrClean || '',
      vrAmenities: vrAmenities || '',
      vrReady: vrReady || '',
      readinessImageLink: readinessImageLink || '',
      bookings: assignedBookings.map(booking => ({
        bookingId: booking.bookingId || '',
        customerName: booking.customerName || ''
      })),
      dateStr
    });

    res.json({ success: true, message: 'Shift started and logged successfully!', shiftRowIndex: shift._id.toString() });
  } catch (error) {
    console.error('Error starting shift:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Trip photo upload (Start from Parking / Pickup / Drop)
// Stored to Drive only for now — no Google Sheets write.
app.post('/api/trip-photo/upload', upload.single('image'), async (req, res) => {
  const { photoType, chauffeurName, bookingId } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No photo provided.' });
  }

  const namePrefixMap = {
    parking: 'Start_from_parking',
    pickup: 'pickup',
    drop: 'drop'
  };

  if (!namePrefixMap[photoType]) {
    return res.status(400).json({ error: 'Invalid photo type.' });
  }

  const webAppUrl = process.env.KM_TRACK_APPS_SCRIPT_WEB_URL;
  if (!webAppUrl) {
    return res.status(503).json({ error: 'Photo upload destination not configured. Contact admin.' });
  }

  try {
    const d = new Date();
    const dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    const cleanBookingId = (bookingId || 'NA').toString().trim() || 'NA';
    const driveFileName = `${namePrefixMap[photoType]}_${cleanBookingId}_${chauffeurName || 'Unknown'}_${dateStr}.jpg`;
    const base64Image = file.buffer.toString('base64');

    const fetchRes = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64: base64Image,
        fileName: driveFileName,
        mimeType: file.mimetype
      })
    });

    const result = await fetchRes.json();
    if (!result.success) {
      console.error('Trip photo upload failed:', result.error);
      return res.status(500).json({ error: 'Failed to upload photo to Drive.' });
    }

    res.json({ success: true, webViewLink: result.webViewLink });
  } catch (error) {
    console.error('Error uploading trip photo:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint 2: End Shift (Appends shift end row to Form Responses 1)
app.post('/api/shift/end', upload.single('image'), async (req, res) => {
  const { clientTimestamp, shiftRowIndex, chauffeurName, chauffeurNumber, isAutoEnd } = req.body;
  const file = req.file;
  const skipLogoutTime = isAutoEnd === 'true' || isAutoEnd === true;

  try {
    const localTime = clientTimestamp || new Date().toLocaleString('en-US', { hour12: true });

    let imageLink = '';
    // If an image was uploaded, upload it via Google Apps Script Web App
    if (file) {
      const webAppUrl = process.env.APPS_SCRIPT_WEB_APP_URL;
      if (webAppUrl) {
        const d = new Date();
        const dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        const driveFileName = `end_shift_${chauffeurName || 'Unknown'}_${dateStr}.jpg`;
        const base64Image = file.buffer.toString('base64');

        try {
          const fetchRes = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64: base64Image,
              fileName: driveFileName,
              mimeType: file.mimetype
            })
          });

          const result = await fetchRes.json();
          if (result.success) {
            imageLink = result.webViewLink;
          } else {
            console.error("Apps Script upload failed:", result.error);
          }
        } catch (uploadErr) {
          console.error("Error uploading to Apps Script:", uploadErr);
        }
      } else {
        console.warn('APPS_SCRIPT_WEB_APP_URL not set in .env. Skipping image upload.');
      }
    }

    if (shiftRowIndex && mongoose.Types.ObjectId.isValid(shiftRowIndex)) {
      const shift = await Shift.findById(shiftRowIndex);
      if (shift) {
        if (!skipLogoutTime) shift.logOutTime = localTime;
        if (imageLink) shift.endShiftImageLink = imageLink;
        await shift.save();
      }
    } else {
      // Fallback if no shiftRowIndex is provided
      const dateStr = getCalendarDateFromLogInTime(localTime);

      await Shift.create({
        chauffeur: { name: chauffeurName, number: chauffeurNumber },
        logOutTime: skipLogoutTime ? '' : localTime,
        endShiftImageLink: imageLink || '',
        dateStr
      });
    }

    res.json({ success: true, message: 'Shift ended and logged successfully!', imageLink });
  } catch (error) {
    console.error('Error ending shift:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fallback route: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BizTravex Chauffeur Portal running on http://localhost:${PORT}`);
});

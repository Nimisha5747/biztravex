const express = require('express');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const Admin = require('../models/Admin');
const Chauffeur = require('../models/Chauffeur');
const Shift = require('../models/Shift');
const mongoose = require('mongoose');
const {
  getSheetsClient,
  parseRowDateTime,
  IST_OFFSET_MS,
  getCalendarDateFromLogInTime,
  driveLinkToImageUrl
} = require('../utils/sheetsHelpers');

const router = express.Router();

// Master-sheet column indices
const MS_BOOKING_ID = 1;      // B
const MS_CUSTOMER_NAME = 2;   // C
const MS_PICKUP_ADDRESS = 8;  // I
const MS_DROP_ADDRESS = 9;    // J
const MS_NAME = 11;           // L
const MS_DATE = 16;           // Q
const MS_PICKUP_TIME = 17;    // R

// ================= CHAUFFEUR + RESPONSES SECTION =================

// Step B: given a chauffeur + date, return booking-id widgets with 5 summary fields
router.get('/responses/booking-ids', requireAdminAuth, async (req, res) => {
  const { chauffeurId, date } = req.query;

  if (!chauffeurId || !date) {
    return res.status(400).json({ error: 'chauffeurId and date are required.' });
  }

  try {
    const chauffeur = await Chauffeur.findById(chauffeurId).lean();
    if (!chauffeur) {
      return res.status(404).json({ error: 'Chauffeur not found.' });
    }

    const cleanUserMobile = chauffeur.number.replace(/\D/g, '').slice(-9);

    // Find all shifts on this date for this chauffeur
    const shifts = await Shift.find({
      dateStr: date,
      "chauffeur.number": { $regex: cleanUserMobile + '$' }
    }).lean();

    const matchingBookingIds = [];
    shifts.forEach(shift => {
      shift.bookings.forEach(b => {
        if (b.bookingId) {
          matchingBookingIds.push(b.bookingId);
        }
      });
    });

    if (matchingBookingIds.length === 0) {
      return res.json({ bookings: [] });
    }

    const sheets = getSheetsClient();
    if (!sheets) {
      return res.status(503).json({ error: 'Sheets data source unavailable. Contact admin.' });
    }

    // Fetch Master-sheet to get display fields for these booking IDs
    const masterResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'Master-sheet'!A1:Z5000`,
    });
    const masterRows = masterResponse.data.values || [];

    const masterLookup = {};
    for (let i = 1; i < masterRows.length; i++) {
      const rowBookingId = masterRows[i][MS_BOOKING_ID] ? masterRows[i][MS_BOOKING_ID].toString().trim() : '';
      if (!rowBookingId) continue;
      masterLookup[rowBookingId] = masterRows[i];
    }

    const bookings = matchingBookingIds.map(bId => {
      const masterRow = masterLookup[bId];
      if (!masterRow) {
        return { bookingId: bId, dateTime: 'Not found in Master-sheet', customerName: '', pickupAddress: '', dropAddress: '' };
      }

      const rawDate = masterRow[MS_DATE];
      const rawTime = masterRow[MS_PICKUP_TIME];
      const parsed = parseRowDateTime(rawDate, rawTime);

      let dateTimeDisplay = 'Unknown';
      if (parsed) {
        const istDate = new Date(parsed.getTime() + IST_OFFSET_MS);
        dateTimeDisplay = istDate.toLocaleString('en-US', {
          timeZone: 'UTC',
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true
        });
      }

      return {
        bookingId: bId,
        dateTime: dateTimeDisplay,
        customerName: masterRow[MS_CUSTOMER_NAME] ? masterRow[MS_CUSTOMER_NAME].toString().trim() : 'Unknown',
        pickupAddress: masterRow[MS_PICKUP_ADDRESS] ? masterRow[MS_PICKUP_ADDRESS].toString().trim() : '',
        dropAddress: masterRow[MS_DROP_ADDRESS] ? masterRow[MS_DROP_ADDRESS].toString().trim() : ''
      };
    });

    res.json({ bookings });
  } catch (error) {
    console.error('Error fetching booking-ids:', error);
    res.status(500).json({ error: error.message });
  }
});

// Step C: given a chauffeur + date + bookingId, return the full structured response
router.get('/responses/booking-detail', requireAdminAuth, async (req, res) => {
  const { chauffeurId, date, bookingId } = req.query;

  if (!chauffeurId || !date || !bookingId) {
    return res.status(400).json({ error: 'chauffeurId, date, and bookingId are required.' });
  }

  try {
    const chauffeur = await Chauffeur.findById(chauffeurId).lean();
    if (!chauffeur) {
      return res.status(404).json({ error: 'Chauffeur not found.' });
    }
    const cleanUserMobile = chauffeur.number.replace(/\D/g, '').slice(-9);

    const shift = await Shift.findOne({
      dateStr: date,
      "chauffeur.number": { $regex: cleanUserMobile + '$' },
      "bookings.bookingId": bookingId
    }).lean();

    if (!shift) {
      return res.status(404).json({ error: 'Booking response not found for this chauffeur on this date.' });
    }

    const bookingRow = shift.bookings.find(br => br.bookingId === bookingId);
    if (!bookingRow) {
      return res.status(404).json({ error: 'Booking response not found for this chauffeur on this date.' });
    }

    res.json({
      bookingId: bookingRow.bookingId,
      chauffeurName: chauffeur.name,
      rowIndex: `${shift._id}:${bookingRow.bookingId}`,
      readinessImageUrl: driveLinkToImageUrl(shift.readinessImageLink),
      endShiftImageUrl: driveLinkToImageUrl(shift.endShiftImageLink),
      logoutTime: shift.logOutTime,
      fields: {
        carCleaned: bookingRow.carCleaned,
        phoneCharged: bookingRow.phoneCharged,
        enoughPetrol: bookingRow.enoughPetrol,
        status: bookingRow.status,
        guestDetails: bookingRow.guestDetails,
        luggageDetails: bookingRow.luggageDetails,
        operationalIssues: bookingRow.operationalIssues,
        checkboxAnswers: bookingRow.checkboxAnswers,
        issueDescription: bookingRow.issueDescription,
        guestFeedbackOptions: bookingRow.guestFeedbackOptions,
        guestFeedbackText: bookingRow.guestFeedbackText,
        remarks: bookingRow.remarks
      }
    });
  } catch (error) {
    console.error('Error fetching booking-detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save edits back to MongoDB
router.patch('/responses/booking-detail', requireAdminAuth, async (req, res) => {
  const { rowIndex, fields } = req.body;

  if (!rowIndex || !fields) {
    return res.status(400).json({ error: 'rowIndex and fields are required.' });
  }

  try {
    const parts = rowIndex.split(':');
    if (parts.length < 2) {
      return res.status(400).json({ error: 'Invalid rowIndex format.' });
    }
    const shiftId = parts[0];
    const bookingId = parts[1];

    if (!mongoose.Types.ObjectId.isValid(shiftId)) {
      return res.status(400).json({ error: 'Invalid shift ID.' });
    }

    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({ error: 'Shift response not found.' });
    }

    const booking = shift.bookings.find(b => b.bookingId === bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Booking response not found inside the shift.' });
    }

    // Update fields
    booking.carCleaned = fields.carCleaned || '';
    booking.phoneCharged = fields.phoneCharged || '';
    booking.enoughPetrol = fields.enoughPetrol || '';
    booking.status = fields.status || '';
    booking.guestDetails = fields.guestDetails || '';
    booking.luggageDetails = fields.luggageDetails || '';
    booking.operationalIssues = fields.operationalIssues || '';
    booking.checkboxAnswers = fields.checkboxAnswers || '';
    booking.issueDescription = fields.issueDescription || '';
    booking.guestFeedbackOptions = fields.guestFeedbackOptions || '';
    booking.guestFeedbackText = fields.guestFeedbackText || '';
    booking.remarks = fields.remarks || '';

    await shift.save();

    res.json({ success: true, message: 'Response updated successfully.' });
  } catch (error) {
    console.error('Error updating response:', error);
    res.status(500).json({ error: error.message });
  }
});

// Separate session cookie for admins — completely independent from chauffeur sessions
router.use(cookieSession({
  name: 'biztravex_admin_session',
  keys: [process.env.ADMIN_SESSION_SECRET || 'admin_default_secret_key'],
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
}));

// Middleware: require a logged-in admin for protected routes
function requireAdminAuth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  next();
}

// ================= AUTH ROUTES =================

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const admin = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    req.session.admin = {
      id: admin._id.toString(),
      email: admin.email,
      name: admin.name
    };

    res.json({ success: true, admin: req.session.admin });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ success: true, message: 'Logged out successfully.' });
});

router.get('/me', (req, res) => {
  res.json({
    loggedIn: !!req.session.admin,
    admin: req.session.admin || null
  });
});

// ================= CHAUFFEUR MANAGEMENT =================

router.get('/chauffeurs', requireAdminAuth, async (req, res) => {
  try {
    const chauffeurs = await Chauffeur.find({}).sort({ name: 1 }).lean();
    res.json({ chauffeurs });
  } catch (error) {
    console.error('Error fetching chauffeurs:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/chauffeurs', requireAdminAuth, async (req, res) => {
  const { name, number } = req.body;

  if (!name || !number) {
    return res.status(400).json({ error: 'Name and mobile number are required.' });
  }

  const cleanName = name.trim();
  const cleanNumber = number.trim();

  try {
    const existing = await Chauffeur.findOne({ number: cleanNumber });
    if (existing) {
      return res.status(400).json({ error: 'A chauffeur with this mobile number already exists.' });
    }

    const chauffeur = await Chauffeur.create({ name: cleanName, number: cleanNumber });
    res.json({ success: true, chauffeur });
  } catch (error) {
    console.error('Error adding chauffeur:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/chauffeurs/:id', requireAdminAuth, async (req, res) => {
  try {
    const deleted = await Chauffeur.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Chauffeur not found.' });
    }
    res.json({ success: true, message: 'Chauffeur deleted.' });
  } catch (error) {
    console.error('Error deleting chauffeur:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export both the router and the middleware so index.js / future route files can use requireAdminAuth
module.exports = { router, requireAdminAuth };
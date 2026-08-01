const express = require('express');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Chauffeur = require('../models/Chauffeur');
const Shift = require('../models/Shift');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Attendance = require('../models/Attendance');
const { JWT_SECRET } = require('../middleware/auth');
const {
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

// Middleware: require a logged-in admin for protected routes
async function requireAdminAuth(req, res, next) {
  try {
    const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(payload.userId);
      if (user && user.role === 'admin') {
        req.adminUser = user;
        return next();
      }
    }
  } catch (err) {
    // Ignore
  }
  return res.status(401).json({ error: 'Not authenticated. Please log in.' });
}

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

    // Fetch corresponding bookings from MongoDB Booking collection
    const bookingDocs = await Booking.find({ bookingId: { $in: matchingBookingIds } }).lean();

    const masterLookup = {};
    bookingDocs.forEach(doc => {
      masterLookup[doc.bookingId] = doc;
    });

    const bookings = matchingBookingIds.map(bId => {
      const doc = masterLookup[bId];
      if (!doc) {
        return { bookingId: bId, dateTime: 'Not found in Database', customerName: '', pickupAddress: '', dropAddress: '' };
      }

      let dateTimeDisplay = 'Unknown';
      if (doc.pickUpDate) {
        try {
          const dateParts = doc.pickUpDate.split('-'); // "YYYY-MM-DD"
          const timeParts = (doc.pickUpTime || '00:00').split(':'); // "HH:MM"
          if (dateParts.length === 3) {
            const dateObj = new Date(Date.UTC(
              parseInt(dateParts[0]), 
              parseInt(dateParts[1]) - 1, 
              parseInt(dateParts[2]), 
              parseInt(timeParts[0] || '0'), 
              parseInt(timeParts[1] || '0')
            ));
            dateTimeDisplay = dateObj.toLocaleString('en-US', {
              timeZone: 'UTC',
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true
            });
          }
        } catch (e) {
          dateTimeDisplay = `${doc.pickUpDate} ${doc.pickUpTime || ''}`.trim();
        }
      }

      return {
        bookingId: bId,
        dateTime: dateTimeDisplay,
        customerName: doc.customerName || 'Unknown',
        pickupAddress: doc.pickupAddress || '',
        dropAddress: doc.dropAddress || ''
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

// ================= AUTH ROUTES =================

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(payload.userId);
      if (user && user.role === 'admin') {
        return res.json({
          loggedIn: true,
          admin: {
            id: user._id.toString(),
            email: user.email,
            name: user.name
          }
        });
      }
    }
  } catch (err) {
    // Ignore
  }

  res.json({
    loggedIn: false,
    admin: null
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

// ================= ATTENDANCE ROUTES =================

const getTodayISTString = () => {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (330 * 60000));
  return ist.toISOString().split('T')[0];
};

router.get('/attendance/chauffeurs-with-mtd', requireAdminAuth, async (req, res) => {
  try {
    const chauffeurs = await Chauffeur.find({}).sort({ name: 1 }).lean();
    const todayStr = getTodayISTString();
    const monthPrefix = todayStr.substring(0, 7);

    const monthlyRecords = await Attendance.find({
      date: { $regex: new RegExp('^' + monthPrefix) }
    }).lean();

    const recordsMap = {};
    monthlyRecords.forEach(r => {
      const cId = r.chauffeurId.toString();
      if (!recordsMap[cId]) recordsMap[cId] = [];
      recordsMap[cId].push(r);
    });

    const result = chauffeurs.map(c => {
      const cId = c._id.toString();
      const chauffeurRecords = recordsMap[cId] || [];
      const todayRecord = chauffeurRecords.find(r => r.date === todayStr);

      let presentDay = 0;
      let presentNight = 0;
      let absent = 0;
      let leave = 0;
      let weeklyOff = 0;
      let overtimeMinutes = 0;

      chauffeurRecords.forEach(r => {
        if (r.status === 'Present-Day') presentDay++;
        else if (r.status === 'Present-Night') presentNight++;
        else if (r.status === 'Absent') absent++;
        else if (r.status === 'Leave') leave++;
        else if (r.status === 'Weekly-Off') weeklyOff++;
        overtimeMinutes += r.overtimeMinutes || 0;
      });

      return {
        _id: cId,
        name: c.name,
        mobileNo: c.number,
        todayStatus: todayRecord ? todayRecord.status : undefined,
        todayLastTime: todayRecord ? todayRecord.lastTimeIn : undefined,
        mtd: {
          presentDay,
          presentNight,
          absent,
          leave,
          weeklyOff,
          overtimeMinutes
        }
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching chauffeurs with mtd:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/attendance/mark-today', requireAdminAuth, async (req, res) => {
  const { chauffeurId, status } = req.body;
  if (!chauffeurId || !status) {
    return res.status(400).json({ error: 'Chauffeur ID and status are required.' });
  }

  try {
    const todayStr = getTodayISTString();
    const updated = await Attendance.findOneAndUpdate(
      { chauffeurId, date: todayStr },
      { status },
      { upsert: true, new: true }
    );
    res.json({ success: true, record: updated });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/attendance/enter-last-time', requireAdminAuth, async (req, res) => {
  const { chauffeurId, lastTimeIn } = req.body;
  if (!chauffeurId || !lastTimeIn) {
    return res.status(400).json({ error: 'Chauffeur ID and clock-out time are required.' });
  }

  try {
    const todayStr = getTodayISTString();
    const record = await Attendance.findOne({ chauffeurId, date: todayStr });
    if (!record) {
      return res.status(400).json({ error: 'Please mark attendance first before entering last time.' });
    }

    record.lastTimeIn = lastTimeIn;
    record.overtimeMinutes = 0; // Overtime calculation left for later
    await record.save();

    res.json({ success: true, record });
  } catch (error) {
    console.error('Error entering last time:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/attendance/history/:id', requireAdminAuth, async (req, res) => {
  try {
    const records = await Attendance.find({ chauffeurId: req.params.id }).sort({ date: -1 }).lean();
    res.json(records);
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, requireAdminAuth };

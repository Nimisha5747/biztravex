const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const Chauffeur = require('../models/Chauffeur');
const Shift = require('../models/Shift');
const Booking = require('../models/Booking');
const { IST_OFFSET_MS, parseRowDateTime, getCalendarDateFromLogInTime } = require('../utils/sheetsHelpers');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ================= AUTHENTICATION ROUTES (Chauffeur Native) =================

// Register a new chauffeur natively
router.post('/api/chauffeur/auth/register', async (req, res) => {
  const { name, number } = req.body;

  if (!name || !number) {
    return res.status(400).json({ error: 'Please provide both Name and Mobile Number.' });
  }

  const cleanName = name.trim();
  const cleanNumber = number.trim();

  try {
    const existing = await Chauffeur.findOne({ number: cleanNumber });
    if (existing) {
      return res.status(400).json({ error: 'Mobile number already registered. Please log in.' });
    }

    await Chauffeur.create({ name: cleanName, number: cleanNumber });
    res.json({ success: true, message: 'Account created successfully! You can now log in.' });
  } catch (error) {
    console.error('Error registering chauffeur:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login chauffeur natively
router.post('/api/chauffeur/auth/login', async (req, res) => {
  const { name, number } = req.body;

  if (!name || !number) {
    return res.status(400).json({ error: 'Please enter Name and Mobile Number.' });
  }

  const cleanName = name.trim();
  const cleanNumber = number.trim();

  try {
    const foundChauffeur = await Chauffeur.findOne({ number: cleanNumber });
    if (!foundChauffeur) {
      return res.status(401).json({
        error: 'No account found matching this mobile number. Please click "Create an Account" first.',
      });
    }

    if (foundChauffeur.name.toLowerCase().trim() !== cleanName.toLowerCase()) {
      return res.status(401).json({
        error: 'The mobile number and name do not match our records. Please try again.',
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
router.get('/api/me', (req, res) => {
  res.json({
    loggedIn: !!(req.session && req.session.chauffeur),
    chauffeur: (req.session && req.session.chauffeur) || null,
  });
});

// ================= PUNCH IN & PUNCH OUT ROUTES =================

// Endpoint: Fetch assigned bookings for today's shift within a 14-hour window
router.get('/api/bookings/shift-window', async (req, res) => {
  const { startTime, name } = req.query;

  if (!startTime || !name) {
    return res.status(400).json({ error: 'Missing startTime or chauffeur name.' });
  }

  const cleanUserName = name.trim().toLowerCase();

  try {
    const parsedRaw = new Date(`${startTime} UTC`);
    if (isNaN(parsedRaw.getTime())) {
      return res.status(400).json({ error: 'Invalid startTime format.' });
    }
    const shiftStart = new Date(parsedRaw.getTime() - IST_OFFSET_MS);
    if (isNaN(shiftStart.getTime())) {
      return res.status(400).json({ error: 'Invalid startTime format.' });
    }

    const shiftStartWindow = shiftStart;
    const shiftEnd = new Date(shiftStart.getTime() + 14 * 60 * 60 * 1000);

    // Query MongoDB for all bookings matching the chauffeur's name (case-insensitive)
    const chauffeurBookings = await Booking.find({
      chauffeurName: { $regex: new RegExp("^" + cleanUserName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$", "i") }
    }).lean();

    const assignedBookings = [];

    for (const booking of chauffeurBookings) {
      if (!booking.bookingId) continue;

      const rowDateTime = parseRowDateTime(booking.pickUpDate, booking.pickUpTime);

      if (rowDateTime && rowDateTime >= shiftStartWindow && rowDateTime <= shiftEnd) {
        assignedBookings.push({
          bookingId: booking.bookingId,
          customerName: booking.customerName || 'Unknown'
        });
      }
    }

    res.json({ bookings: assignedBookings });
  } catch (error) {
    console.error('Error in shift-window bookings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Punch In Submit (Pre-shift checklist for selected booking ID)
router.post('/api/punch-in', async (req, res) => {
  const { bookingId, carCleaned, phoneCharged, enoughPetrol, chauffeur } = req.body;
  const name = chauffeur ? chauffeur.name : (req.session.chauffeur ? req.session.chauffeur.name : 'Unknown');
  const number = chauffeur ? chauffeur.number : (req.session.chauffeur ? req.session.chauffeur.number : '');

  if (!bookingId) {
    return res.status(400).json({ error: 'Please select a Booking ID for Punch In.' });
  }

  try {
    const cleanUserMobile = number.replace(/\D/g, '').slice(-9);

    const shift = await Shift.findOne({
      "chauffeur.number": { $regex: cleanUserMobile + '$' },
      "bookings.bookingId": bookingId
    }).sort({ createdAt: -1 });

    if (shift) {
      const booking = shift.bookings.find(b => b.bookingId === bookingId);
      if (booking) {
        booking.carCleaned = carCleaned || '';
        booking.phoneCharged = phoneCharged || '';
        booking.enoughPetrol = enoughPetrol || '';
        await shift.save();
      }
    } else {
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
router.post('/api/punch-out', async (req, res) => {
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

// Endpoint: Start Shift (Readiness Checklist)
router.post('/api/shift/start', upload.array('readinessImages', 10), async (req, res) => {
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

    let readinessImageLinks = [];
    const webAppUrl = process.env.END_SHIFT_APPS_SCRIPT_WEB_APP_URL;
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
    }

    const readinessImageLink = readinessImageLinks.join('\n');
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

// Endpoint: Trip photo upload (Odometer photos)
router.post('/api/trip-photo/upload', upload.single('image'), async (req, res) => {
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

// Endpoint: End Shift
router.post('/api/shift/end', upload.single('image'), async (req, res) => {
  const { clientTimestamp, shiftRowIndex, chauffeurName, chauffeurNumber, isAutoEnd } = req.body;
  const file = req.file;
  const skipLogoutTime = isAutoEnd === 'true' || isAutoEnd === true;

  try {
    const localTime = clientTimestamp || new Date().toLocaleString('en-US', { hour12: true });

    let imageLink = '';
    if (file) {
      const webAppUrl = process.env.END_SHIFT_APPS_SCRIPT_WEB_APP_URL;
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

module.exports = router;

const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { connectDatabase } = require('./shared-backend/db');
const app = express();

const PORT = process.env.PORT || 3000;

connectDatabase('CRM Service');

// Module Model Ingest Definitions
const Booking = require('./shared-models/Booking');
const BookingActivityLog = require('./shared-models/BookingActivityLog');
const Zone = require('./shared-models/Zone'); // <-- add this line
const User = require('./shared-models/User');

// NEW: require these only after connectDatabase() has run, so JWT_SECRET is populated
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { requireAuth, JWT_SECRET } = require('./middleware/auth');

// Use memory storage to avoid saving files to disk (No temp folder needed)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const getLocalToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- Determine service type from pickup/drop address ---
const getServiceType = (pickupAddress, dropAddress) => {
    const pickupHasAirport = /airport/i.test(pickupAddress || "");
    const dropHasAirport = /airport/i.test(dropAddress || "");
    if (pickupHasAirport && dropHasAirport) return "—";
    if (pickupHasAirport) return "Pickup";
    if (dropHasAirport) return "Drop";
    return "—";
};

// ── Auth Routes ─────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await new User({ email: email.toLowerCase().trim(), passwordHash, name: name || '' }).save();

        res.json({ success: true, message: 'Account created. Please log in.', userId: user._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

        const token = jwt.sign({ userId: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ success: true, token, user: { email: user.email, name: user.name } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: { email: req.user.email, name: req.user.name } });
});

// Search Pipeline Query Ingest Route
app.post('/api/bookings/filter', requireAuth, async (req, res) => {
    try {
        let queryParams = {};
        const filters = req.body.filters || {};

        Object.keys(filters).forEach(key => {
            if (filters[key]) {
                const fieldName = key === 'date' ? 'pickUpDate' : key; // map frontend "date" -> schema's "pickUpDate"
                const escapedValue = String(filters[key]).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex special chars
                const regexFlag = fieldName === 'bookingId' ? "" : "i";
                queryParams[fieldName] = { $regex: new RegExp("^" + escapedValue + "$", regexFlag) };
            }
        });

        const matches = await Booking.find(queryParams).sort({ createdAt: -1 });
        // console.log(matches)
        res.json(matches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search execution engine fault." });
    }
});

// Chronological Ingest Logs History Route
app.get('/api/bookings/logs/:bookingId', requireAuth, async (req, res) => {
    try {
        const history = await BookingActivityLog.find({ bookingId: req.params.bookingId }).sort({ timestamp: -1 });
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: "Audit history lookup broken." });
    }
});

// Manual Booking Creation Route
app.post('/api/bookings/manual', requireAuth, async (req, res) => {
    try {
        const {
            bookingId, pickUpDate, pickUpTime, clientName, customerName, customerMobile,
            flightNumber, vendorName, noOfPassengers, noOfInfants, noOfBaby, noOfLuggages,
            pickupAddress, dropAddress, carType
        } = req.body;

        const newDoc = new Booking({
            bookingId: bookingId || `BIZ-${Date.now()}`,
            pickUpDate,
            pickUpTime: pickUpTime || '00:00',
            clientName: clientName || '—',
            customerName: customerName || 'TBD',
            customerMobile: customerMobile || '—',
            flightNumber: flightNumber || '—',
            vendorName: vendorName || '—',
            noOfPassengers: parseInt(noOfPassengers) || 1,
            noOfInfants: parseInt(noOfInfants) || 0,
            noOfBaby: parseInt(noOfBaby) || 0,
            noOfLuggages: parseInt(noOfLuggages) || 0,
            pickupAddress: pickupAddress || '—',
            dropAddress: dropAddress || '—',
            serviceType: getServiceType(pickupAddress, dropAddress),
            carType: carType || '—',
            status: 'Upcoming',
            bookingSource: 'Manual Entry',
            chauffeurName: '—',
            chauffeurPhone: '—'
        });

        await newDoc.save();

        await new BookingActivityLog({
            bookingId: newDoc.bookingId,
            updatedBy: req.user.name || req.user.email,
            action: "Manual Booking Created",
            changesMade: { status: { old: "—", new: "Upcoming" } }
        }).save();

        res.json({ success: true, doc: newDoc });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create manual booking." });
    }
});

// Single-field update route (new inline form) — also handles legacy multi-field payload
app.post('/api/bookings/update', requireAuth, async (req, res) => {
    const { id, field, newValue, description } = req.body;
    const userSignature = req.user.name || req.user.email; // NEW: derive from authenticated session

    // ── Legacy multi-field path ────────────────────────────────────────────────
    if (!field && req.body.status !== undefined) {
        const { status, chauffeurName, chauffeurPhone, carNumber } = req.body;
        try {
            const currentDoc = await Booking.findById(id);
            if (!currentDoc) return res.status(404).json({ error: "Booking not found." });

            let loggedChanges = {};
            const fieldsToTrack = { status, chauffeurName, chauffeurPhone, carNumber };
            Object.keys(fieldsToTrack).forEach(f => {
                if (fieldsToTrack[f] !== undefined && String(fieldsToTrack[f]).trim() !== String(currentDoc[f] || '')) {
                    loggedChanges[f] = { old: currentDoc[f] || '—', new: String(fieldsToTrack[f]).trim() };
                    currentDoc[f] = String(fieldsToTrack[f]).trim();
                }
            });
            if (Object.keys(loggedChanges).length > 0) {
                await currentDoc.save();
                await new BookingActivityLog({
                    bookingId: currentDoc.bookingId,
                    updatedBy: userSignature || 'Dispatcher Console',
                    action: 'Manual Row Update Modification',
                    changesMade: loggedChanges
                }).save();
            }
            return res.json({ success: true, doc: currentDoc });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to submit revisions.' });
        }
    }

    // ── Single-field path (new inline update form) ────────────────────────────
    if (!field || newValue === undefined || newValue === null) {
        return res.status(400).json({ error: 'field and newValue are required.' });
    }

    try {
        const currentDoc = await Booking.findById(id);
        if (!currentDoc) return res.status(404).json({ error: 'Booking not found.' });

        const oldValue = currentDoc[field] !== undefined ? String(currentDoc[field]) : '—';
        const newValueStr = String(newValue).trim();

        if (oldValue === newValueStr) {
            return res.json({ success: true, message: 'No change detected.', doc: currentDoc });
        }

        // Apply the field update
        currentDoc[field] = newValueStr;
        await currentDoc.save();

        // Write audit log entry — use a friendlier action label for remarks
        const actionLabel = field === 'remarks' ? 'Remark Added' : `Field Updated: ${field}`;

        const auditEntry = new BookingActivityLog({
            bookingId: currentDoc.bookingId,
            updatedBy: String(userSignature).trim(),
            action: actionLabel,
            changesMade: {
                [field]: { old: oldValue, new: newValueStr }
            }
        });
        await auditEntry.save();

        res.json({ success: true, doc: currentDoc });
    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ error: 'Failed to save update.' });
    }
});

// ── Zone Management Routes ─────────────────────────────────────────────────
app.get('/api/zones', requireAuth, async (req, res) => {
    try {
        const zones = await Zone.find({}).sort({ minKm: 1 });
        res.json(zones);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch zones.' });
    }
});

app.post('/api/zones', requireAuth, async (req, res) => {
    try {
        const { name, minKm, maxKm } = req.body;
        if (!name || minKm === undefined || maxKm === undefined) {
            return res.status(400).json({ error: 'name, minKm and maxKm are required.' });
        }
        const min = parseFloat(minKm);
        const max = parseFloat(maxKm);
        if (isNaN(min) || isNaN(max)) {
            return res.status(400).json({ error: 'minKm and maxKm must be numbers.' });
        }
        if (max < min) {
            return res.status(400).json({ error: 'maxKm must be greater than or equal to minKm.' });
        }

        const zone = new Zone({ name: String(name).trim(), minKm: min, maxKm: max });
        await zone.save();
        res.json({ success: true, zone });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create zone.' });
    }
});

app.delete('/api/zones/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await Zone.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Zone not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete zone.' });
    }
});

// Ingest Master Spreadsheet Route
app.post('/api/bookings/upload-dump', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Payload sheet missing." });
    try {
        // --- Extract clientName from filename pattern: <clientName>_dump_<DD-MM> ---
        const originalName = req.file.originalname;
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
        const fileNameMatch = nameWithoutExt.match(/^(.+?)_dump_(\d{1,2}-\d{1,2}|\d{1,2}[A-Za-z]{3})$/i);
        const clientName = fileNameMatch ? fileNameMatch[1].trim() : "Unknown";

        // --- Helper to Robustly Parse Excel Dates to YYYY-MM-DD ---
        const parseExcelDate = (val) => {
            if (!val) return "—";

            // 1. Genuine JavaScript Date Object
            if (val instanceof Date && !isNaN(val)) {
                const y = val.getFullYear();
                const m = String(val.getMonth() + 1).padStart(2, '0');
                const d = String(val.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }

            // 2. Numeric Excel Serial Number
            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                if (!isNaN(date)) {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const d = String(date.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
            }

            // 3. String Input Handling
            if (typeof val === 'string') {
                const trimmed = val.trim();

                // 🚀 PATTERN 1: Handles "1-Jul", "01-Jul", "1/Jul" (DD-MMM)
                const ddMmmMatch = trimmed.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})$/);
                if (ddMmmMatch) {
                    const day = ddMmmMatch[1].padStart(2, '0');
                    const monthName = ddMmmMatch[2].toLowerCase().substring(0, 3);
                    const monthsMap = {
                        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
                        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
                    };
                    const month = monthsMap[monthName];
                    if (month) {
                        const currentYear = new Date().getFullYear();
                        return `${currentYear}-${month}-${day}`;
                    }
                }

                // 🚀 PATTERN 2: Handles "Jul-1", "Jul-01", "Jul/1" (MMM-DD)
                const mmmDdMatch = trimmed.match(/^([A-Za-z]{3,9})[-/](\d{1,2})$/);
                if (mmmDdMatch) {
                    const monthName = mmmDdMatch[1].toLowerCase().substring(0, 3);
                    const day = mmmDdMatch[2].padStart(2, '0');
                    const monthsMap = {
                        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
                        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
                    };
                    const month = monthsMap[monthName];
                    if (month) {
                        const currentYear = new Date().getFullYear();
                        return `${currentYear}-${month}-${day}`;
                    }
                }

                // Numeric-looking string, e.g. "46204" — treat as Excel serial
                if (/^\d+(\.\d+)?$/.test(trimmed)) {
                    const date = new Date(Math.round((parseFloat(trimmed) - 25569) * 86400 * 1000));
                    if (!isNaN(date)) {
                        const y = date.getFullYear();
                        const m = String(date.getMonth() + 1).padStart(2, '0');
                        const d = String(date.getDate()).padStart(2, '0');
                        return `${y}-${m}-${d}`;
                    }
                }

                // DD-MM-YYYY or DD/MM/YYYY — explicit, no ambiguity
                const ddmmyyyy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
                if (ddmmyyyy) {
                    const d = ddmmyyyy[1].padStart(2, '0');
                    const m = ddmmyyyy[2].padStart(2, '0');
                    const y = ddmmyyyy[3];
                    return `${y}-${m}-${d}`;
                }

                // Fallback — ISO or unambiguous formats only
                const parsed = new Date(trimmed);
                if (!isNaN(parsed)) {
                    const y = parsed.getFullYear();
                    const m = String(parsed.getMonth() + 1).padStart(2, '0');
                    const d = String(parsed.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }

                return trimmed;
            }

            return String(val).trim();
        };



        // --- Helper to robustly parse Excel time values to HH:MM format ---
        const parseExcelTime = (val) => {
            if (val === undefined || val === null || val === '') return "00:00";

            // 1. IF IT IS A DATE OBJECT (SheetJS fallback)
            if (val instanceof Date && !isNaN(val)) {
                // If SheetJS gives a 1900 date, we look at its raw text value or fall back to local extraction safely
                // To bypass the 1900 bug, we parse the time using standard string conversion if available,
                // or extract modern localized strings:
                const timeStr = val.toLocaleTimeString('en-US', { hour12: false }); // Gives "09:00:00"
                const parts = timeStr.split(':');
                return `${parts[0]}:${parts[1]}`;
            }

            // 2. IF IT IS A NUMERIC EXCEL TIME FRACTION (e.g. 0.375 = 9:00 AM)
            let num = typeof val === 'number' ? val : parseFloat(val);
            if (!isNaN(num) && typeof val !== 'string' || (typeof val === 'string' && /^0?\.\d+$/.test(val.trim()))) {

                // This math is immune to timezone bugs because it extracts purely from the raw file decimal fraction
                const totalSeconds = Math.round(num * 24 * 60 * 60);
                const hours = Math.floor(totalSeconds / 3600) % 24;
                const minutes = Math.floor((totalSeconds % 3600) / 60);

                const h = String(hours).padStart(2, '0');
                const m = String(minutes).padStart(2, '0');
                return `${h}:${m}`;
            }

            // 3. IF IT IS ALREADY A STRING (e.g. "9:00:00 AM" or "09:00")
            if (typeof val === 'string') {
                const trimmed = val.trim();

                // Handle explicit "AM/PM" text patterns
                if (/am|pm/i.test(trimmed)) {
                    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i);
                    if (match) {
                        let hours = parseInt(match[1], 10);
                        const minutes = match[2];
                        const ampm = match[4].toLowerCase();

                        if (ampm === 'pm' && hours < 12) hours += 12;
                        if (ampm === 'am' && hours === 12) hours = 0;

                        return `${String(hours).padStart(2, '0')}:${minutes}`;
                    }
                }
                return trimmed;
            }

            return "00:00";
        };



        // --- Preload all zones once ---
        const zones = await Zone.find({});
        const getZoneForDistance = (km) => {
            const match = zones.find(z => km >= z.minKm && km <= z.maxKm);
            return match ? match.name : "—";
        };

        // // --- Determine service type from pickup/drop address ---
        // const getServiceType = (pickupAddress, dropAddress) => {
        //     const pickupHasAirport = /airport/i.test(pickupAddress || "");
        //     const dropHasAirport = /airport/i.test(dropAddress || "");
        //     if (pickupHasAirport && dropHasAirport) return "—";
        //     if (pickupHasAirport) return "Pickup";
        //     if (dropHasAirport) return "Drop";
        //     return "—";
        // };

        // Read directly from RAM buffer instead of disk path
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: false, raw: false });
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        // --- NEW: Normalize column headers to fix spacing typos ---
        const normalizedRows = rawRows.map(row => {
            const cleanRow = {};
            for (const key in row) {
                // This removes extra spaces between words and trims the edges
                const cleanKey = key.trim().replace(/\s+/g, ' ');
                cleanRow[cleanKey] = row[key];
            }
            return cleanRow;
        });

        let count = 0;

        // Make sure to loop over normalizedRows instead of rawRows!
        for (const row of normalizedRows) {
            const bId = row["Booking ID"];
            if (bId) {
                const pickupAddress = row["Pickup Address"] || "—";
                const dropAddress = row["Drop Address"] || "—";
                const distanceKm = parseFloat(row["Distance(KM)"]) || 0;
                const trimmedId = String(bId).trim();

                // Fetch existing doc BEFORE update, so we can diff against it
                const existingDoc = await Booking.findOne({ bookingId: trimmedId });
                const isNew = !existingDoc;

                const newValues = {
                    bookingId: trimmedId,
                    clientName: clientName,
                    pickUpDate: parseExcelDate(row["Pick Up Date"]),
                    pickUpTime: parseExcelTime(row["Pick Up Time"]),
                    pickupAddress: pickupAddress,
                    dropAddress: dropAddress,
                    carType: row["Car Type"] || "—",
                    distanceKm: distanceKm,
                    noOfLuggages: parseInt(row["No of Luggages"]) || 0,
                    noOfPassengers: parseInt(row["No of Passengers"]) || 0,
                    noOfInfants: parseInt(row["No of Infant"]) || 0,
                    noOfBaby: parseInt(row["No of Baby"]) || 0,
                    flightNumber: row["Flight Number"] || "—",
                    serviceType: getServiceType(pickupAddress, dropAddress),
                    zone: getZoneForDistance(distanceKm),
                    bookingSource: "client",
                    pickUpRegion: row["Pick Up Region"] ? String(row["Pick Up Region"]).trim() : "—",
                    pickUpCountry: row["Pick Up Country"] ? String(row["Pick Up Country"]).trim() : "—",
                    pickUpZipcode: row["Pick Up Zipcode"] ? String(row["Pick Up Zipcode"]).trim() : "—",
                    dropRegion: row["Drop Region"] ? String(row["Drop Region"]).trim() : "—",
                    dropCountry: row["Drop Country"] ? String(row["Drop Country"]).trim() : "—",
                    dropZipcode: row["Drop Zipcode"] ? String(row["Drop Zipcode"]).trim() : "—"
                };

                // --- Diff old vs new values (only for existing bookings) ---
                let changesMade = {};
                if (!isNew) {
                    for (const key of Object.keys(newValues)) {
                        const oldVal = existingDoc[key];
                        const newVal = newValues[key];
                        // Normalize for comparison (avoid false positives from type mismatches, e.g. number vs string)
                        const oldStr = oldVal === undefined || oldVal === null ? "" : String(oldVal);
                        const newStr = newVal === undefined || newVal === null ? "" : String(newVal);
                        if (oldStr !== newStr) {
                            changesMade[key] = { old: oldVal ?? "—", new: newVal };
                        }
                    }
                }

                const doc = await Booking.findOneAndUpdate(
                    { bookingId: trimmedId },
                    newValues,
                    { upsert: true, new: true }
                );

                if (!isNew) {
                    await new BookingActivityLog({
                        bookingId: doc.bookingId,
                        updatedBy: "System File Parser",
                        action: "Updated via Excel Re-uploaded booking",
                        changesMade: changesMade
                    }).save();
                }

                count++;
            }
        }
        res.json({ success: true, message: `Successfully parsed and recorded ${count} entries for client "${clientName}".` });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Spreadsheet structure processing aborted." });
    }
});

// Appending Vendor Manifest Changes Route
app.post('/api/bookings/upload-vendor', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Payload sheet missing." });
    try {
        // --- Extract vendorName from filename, same pattern as dump file: <vendorName>_dump_<DD-MM> ---
        const originalName = req.file.originalname;
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
        const fileNameMatch = nameWithoutExt.match(/^(.+?)_confirm_(\d{1,2}-\d{1,2}|\d{1,2}[A-Za-z]{3})$/i);
        const vendorName = fileNameMatch ? fileNameMatch[1].trim() : "Unknown";

        // --- Parse "Driver's Details" into name + phone ---
        // Example: "FAHAD SHAH HAWALDAR SHAH  0545831884" -> name="FAHAD SHAH HAWALDAR SHAH", phone="0545831884"
        const parseDriverDetails = (trimmed) => {
            if (!trimmed) return null;

            // 1. Extract the string portion from the start (everything before a number or '+')
            const match = trimmed.match(/^([^+\d]+)/);

            if (match) {
                // match[0] contains the exact raw string portion including trailing spaces
                // Save it in textVariable after cleaning extra spaces
                const textVariable = match[0].trim().replace(/\s+/g, ' ');

                // 2. Replace the extracted string portion with "" from the original variable
                const remaining = trimmed.replace(match[0], "");

                // 3. Save the remaining in cleanPhoneVariable after trimming and removing spaces
                const cleanPhoneVariable = remaining.trim().replace(/\s+/g, '');
                // console.log(textVariable, cleanPhoneVariable)

                return {
                    name: textVariable,
                    phone: cleanPhoneVariable
                };
            }

            // Fallback if no letters were found (e.g. they only entered a phone number)
            return null;
        };


        // Read directly from RAM buffer instead of disk path
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        // --- NEW: Normalize column headers to fix spacing typos ---
        const normalizedRows = rawRows.map(row => {
            const cleanRow = {};
            for (const key in row) {
                const cleanKey = key.trim().replace(/\s+/g, ' ');
                cleanRow[cleanKey] = row[key];
            }
            return cleanRow;
        });

        let count = 0;

        // Make sure to loop over normalizedRows instead of rawRows!
        for (const row of normalizedRows) {
            const bId = row["Ref. No"];
            if (bId) {
                const currentDoc = await Booking.findOne({ bookingId: String(bId).trim() });
                if (currentDoc) {
                    let changed = false;
                    let chauffeurAudit = ''; // Track the audit log for driver change

                    const driverDetailsRaw = row["Driver's Details"];
                    const incomingPlate = row["Plate Number"];
                    const { name: incomingChauffeur, phone: incomingPhone } = parseDriverDetails(driverDetailsRaw.trim());
                    // console.log(incomingChauffeur, incomingPhone)

                    if (incomingChauffeur && currentDoc.chauffeurName !== incomingChauffeur) {
                        const oldName = currentDoc.chauffeurName ? currentDoc.chauffeurName : '—';
                        currentDoc.chauffeurName = incomingChauffeur;
                        changed = true;

                        // Create the audit log showing old to new value
                        const timestamp = new Date().toLocaleString('en-GB');
                        chauffeurAudit = `[${timestamp}] '${oldName}' to '${incomingChauffeur}'`;
                    }
                    if (incomingPhone && currentDoc.chauffeurPhone !== incomingPhone) {
                        currentDoc.chauffeurPhone = incomingPhone;
                        changed = true;
                    }
                    if (incomingPlate && currentDoc.carNumber !== String(incomingPlate).trim()) {
                        currentDoc.carNumber = String(incomingPlate).trim();
                        changed = true;
                    }

                    // vendorName always set/updated from filename, regardless of other field changes
                    if (currentDoc.vendorName !== vendorName) {
                        currentDoc.vendorName = vendorName;
                        changed = true;
                    }

                    if (changed) {
                        let newAuditLines = "Chauffeur assigned by vendor upload";
                        if (chauffeurAudit) {
                            newAuditLines += `\n${chauffeurAudit}`;
                        }

                        // Save the changes
                        await currentDoc.save();

                        // Write to the Activity Log instead of the Booking document
                        await new BookingActivityLog({
                            bookingId: currentDoc.bookingId,
                            updatedBy: 'System',
                            action: 'Chauffeur assigned',
                            description: newAuditLines
                        }).save();

                        count++;
                    }
                }
            }
        }
        res.json({ success: true, message: `Successfully tracked and updated fields inside ${count} records.` });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to map spreadsheet rows changes." });
    }
});

app.listen(PORT, () => console.log(`CRM UI Application framework runtime online on port ${PORT}`));

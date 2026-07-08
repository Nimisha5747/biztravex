const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { connectDatabase } = require('../shared-backend/db');
const app = express();

const PORT = process.env.PORT || 3000;

connectDatabase('Home Service');

// Module Model Ingest Definitions
const Booking = require('../shared-models/Booking');
const BookingActivityLog = require('../shared-models/BookingActivityLog');
const Zone = require('../shared-models/Zone'); // <-- add this line


// Cross-platform temp upload directory, created automatically if missing
const uploadDir = path.join(__dirname, 'tmp-uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static('public'));

const getLocalToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Search Pipeline Query Ingest Route
app.post('/api/bookings/filter', async (req, res) => {
    try {
        let queryParams = {};
        const filters = req.body.filters || {};

        Object.keys(filters).forEach(key => {
            if (filters[key]) {
                const fieldName = key === 'date' ? 'pickUpDate' : key; // map frontend "date" -> schema's "pickUpDate"
                const escapedValue = String(filters[key]).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex special chars
                queryParams[fieldName] = { $regex: new RegExp("^" + escapedValue + "$", "i") };
            }
        });

        const matches = await Booking.find(queryParams).sort({ createdAt: -1 });
        res.json(matches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search execution engine fault." });
    }
});

// Chronological Ingest Logs History Route
app.get('/api/bookings/logs/:bookingId', async (req, res) => {
    try {
        const history = await BookingActivityLog.find({ bookingId: req.params.bookingId }).sort({ timestamp: -1 });
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: "Audit history lookup broken." });
    }
});

// Manual Booking Creation Route
app.post('/api/bookings/manual', async (req, res) => {
    try {
        const {
            bookingId, pickUpDate, pickUpTime, clientName, customerName, customerMobile,
            flightNumber, vendorName, noOfPassengers, noOfInfants, noOfBaby, noOfLuggages,
            pickupAddress, dropAddress, serviceType, carType
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
            serviceType: serviceType || '—',
            carType: carType || '—',
            status: 'Upcoming',
            bookingSource: 'Manual Entry',
            chauffeurName: '—',
            chauffeurPhone: '—'
        });

        await newDoc.save();

        await new BookingActivityLog({
            bookingId: newDoc.bookingId,
            updatedBy: "System Dispatcher",
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
app.post('/api/bookings/update', async (req, res) => {
    const { id, field, newValue, description, userSignature } = req.body;

    // ── Legacy multi-field path ────────────────────────────────────────────────
    if (!field && req.body.status !== undefined) {
        const { status, updates, chauffeurName, chauffeurPhone, carNumber } = req.body;
        try {
            const currentDoc = await Booking.findById(id);
            if (!currentDoc) return res.status(404).json({ error: "Booking not found." });

            let loggedChanges = {};
            const fieldsToTrack = { status, updates, chauffeurName, chauffeurPhone, carNumber };
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
    if (!userSignature || !String(userSignature).trim()) {
        return res.status(400).json({ error: 'Author / userSignature is required.' });
    }
    if (!description || !String(description).trim()) {
        return res.status(400).json({ error: 'Remarks / description is required.' });
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

        // Write audit log entry
        const auditEntry = new BookingActivityLog({
            bookingId: currentDoc.bookingId,
            updatedBy: String(userSignature).trim(),
            action: `Field Updated: ${field}`,
            description: String(description).trim(),
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

// Ingest Master Spreadsheet Route
app.post('/api/bookings/upload-dump', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Payload sheet missing." });
    try {
        // --- Extract clientName from filename pattern: <clientName>_dump_<DD-MM> ---
        const originalName = req.file.originalname;
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
        const fileNameMatch = nameWithoutExt.match(/^(.+?)_dump_(\d{2}-\d{2}|\d{2}[A-Za-z]{3})$/i);
        const clientName = fileNameMatch ? fileNameMatch[1].trim() : "Unknown";

        // --- Helper to Robustly Parse Excel Dates to YYYY-MM-DD ---
        const parseExcelDate = (val) => {
            if (!val) return "—";

            if (val instanceof Date && !isNaN(val)) {
                const y = val.getUTCFullYear();
                const m = String(val.getUTCMonth() + 1).padStart(2, '0');
                const d = String(val.getUTCDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }

            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                if (!isNaN(date)) {
                    const y = date.getUTCFullYear();
                    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const d = String(date.getUTCDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
            }

            if (typeof val === 'string') {
                const trimmed = val.trim();

                // Numeric-looking string, e.g. "46204" — treat as Excel serial
                if (/^\d+(\.\d+)?$/.test(trimmed)) {
                    const date = new Date(Math.round((parseFloat(trimmed) - 25569) * 86400 * 1000));
                    if (!isNaN(date)) {
                        const y = date.getUTCFullYear();
                        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
                        const d = String(date.getUTCDate()).padStart(2, '0');
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

            // Case: already a Date object (cellDates: true gave us this)
            if (val instanceof Date && !isNaN(val)) {
                const h = String(val.getUTCHours()).padStart(2, '0');
                const m = String(val.getUTCMinutes()).padStart(2, '0');
                return `${h}:${m}`;
            }

            // Case: numeric Excel time fraction (e.g. 0.5520833 = 13:15)
            let num = typeof val === 'number' ? val : parseFloat(val);
            if (!isNaN(num) && typeof val !== 'string' || (typeof val === 'string' && /^0?\.\d+$/.test(val.trim()))) {
                const totalMinutes = Math.round(num * 24 * 60);
                const h = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
                const m = String(totalMinutes % 60).padStart(2, '0');
                return `${h}:${m}`;
            }

            // Case: already a normal time string like "13:15" or "1:15 PM"
            return String(val).trim();
        };

        // --- Preload all zones once ---
        const zones = await Zone.find({});
        const getZoneForDistance = (km) => {
            const match = zones.find(z => km >= z.minKm && km <= z.maxKm);
            return match ? match.name : "—";
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

        const workbook = xlsx.readFile(req.file.path, { cellDates: true });
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        let count = 0;

        for (const row of rawRows) {
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
                        action: "Updated via Excel Re-upload",
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
app.post('/api/bookings/upload-vendor', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Payload sheet missing." });
    try {
        // --- Extract vendorName from filename, same pattern as dump file: <vendorName>_dump_<DD-MM> ---
        const originalName = req.file.originalname;
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
        const fileNameMatch = nameWithoutExt.match(/^(.+?)_confirm_(\d{2}-\d{2}|\d{2}[A-Za-z]{3})$/i);
        const vendorName = fileNameMatch ? fileNameMatch[1].trim() : "Unknown";

        // --- Parse "Driver's Details" into name + phone ---
        // Example: "FAHAD SHAH HAWALDAR SHAH  0545831884" -> name="FAHAD SHAH HAWALDAR SHAH", phone="0545831884"
        const parseDriverDetails = (raw) => {
            if (!raw) return { name: null, phone: null };
            const trimmed = String(raw).trim();
            // Match trailing digit sequence (phone number) at the end of the string
            const match = trimmed.match(/^(.*?)\s+(\d{6,15})$/);
            if (match) {
                return { name: match[1].trim(), phone: match[2].trim() };
            }
            // Fallback: no phone number found, treat entire string as name
            return { name: trimmed, phone: null };
        };

        const workbook = xlsx.readFile(req.file.path);
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        let count = 0;

        for (const row of rawRows) {
            const bId = row["Ref. No"];
            if (bId) {
                const currentDoc = await Booking.findOne({ bookingId: String(bId).trim() });
                if (currentDoc) {
                    let changed = false;

                    const driverDetailsRaw = row["Driver's Details"];
                    const incomingPlate = row["Plate Number"];
                    const { name: incomingChauffeur, phone: incomingPhone } = parseDriverDetails(driverDetailsRaw);

                    if (incomingChauffeur && currentDoc.chauffeurName !== incomingChauffeur) {
                        currentDoc.chauffeurName = incomingChauffeur;
                        changed = true;
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
                        currentDoc.updates = "Vendor manifest parsed.";
                        await currentDoc.save();
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

app.listen(PORT, () => console.log(`Home UI Application framework runtime online on port ${PORT}`));

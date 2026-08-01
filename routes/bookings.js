const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const Booking = require('../models/Booking');
const BookingActivityLog = require('../models/BookingActivityLog');
const Zone = require('../models/Zone');
const Rate = require('../models/Rate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Determine service type from pickup/drop address ---
const getServiceType = (pickupAddress, dropAddress) => {
    const pickupHasAirport = /airport/i.test(pickupAddress || "");
    const dropHasAirport = /airport/i.test(dropAddress || "");
    if (pickupHasAirport && dropHasAirport) return "—";
    if (pickupHasAirport) return "Pickup";
    if (dropHasAirport) return "Drop";
    return "—";
};

// Search Pipeline Query Ingest Route
router.post('/api/bookings/filter', requireAuth, async (req, res) => {
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
        res.json(matches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search execution engine fault." });
    }
});

// Chronological Ingest Logs History Route
router.get('/api/bookings/logs/:bookingId', requireAuth, async (req, res) => {
    try {
        const history = await BookingActivityLog.find({ bookingId: req.params.bookingId }).sort({ timestamp: -1 });
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: "Audit history lookup broken." });
    }
});

// Manual Booking Creation Route
router.post('/api/bookings/manual', requireAuth, async (req, res) => {
    try {
        const {
            bookingId, pickUpDate, pickUpTime, clientName, customerName, customerMobile,
            flightNumber, vendorName, noOfPassengers, noOfInfants, noOfBaby, noOfLuggages,
            pickupAddress, dropAddress, carType, model,
            chauffeurName, chauffeurPhone, distanceKm
        } = req.body;

        const distanceVal = parseFloat(distanceKm) || 0;

        // Evaluate zone
        const zones = await Zone.find({});
        const match = zones.find(z => distanceVal >= z.minKm && distanceVal <= z.maxKm && distanceVal > 0);
        const zoneVal = match ? match.name : "—";

        // Determine service type
        const serviceType = getServiceType(pickupAddress, dropAddress);

        // Evaluate amountAED
        let amountAED = 0;
        if (distanceVal > 0 && zoneVal !== "—") {
            const rate = await Rate.findOne({ zoneName: zoneVal.trim() });
            if (rate) {
                if (serviceType === 'Pickup') {
                    amountAED = rate.pickupAmount;
                } else if (serviceType === 'Drop') {
                    amountAED = rate.dropAmount;
                }
            }
        }

        const newDoc = new Booking({
            bookingId: bookingId || `BIZ-${Date.now()}`,
            model: model || '—',
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
            serviceType: serviceType,
            zone: zoneVal,
            amountAED: amountAED,
            distanceKm: distanceVal,
            carType: carType || '—',
            status: '—',
            bookingSource: 'Manual Entry',
            chauffeurName: chauffeurName || '—',
            chauffeurPhone: chauffeurPhone || '—'
        });

        await newDoc.save();

        await new BookingActivityLog({
            bookingId: newDoc.bookingId,
            updatedBy: req.user.name || req.user.email,
            action: "Manual Booking Created",
            changesMade: { status: { old: "—", new: "—" } }
        }).save();

        res.json({ success: true, doc: newDoc });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create manual booking." });
    }
});

// Single-field update route
router.post('/api/bookings/update', requireAuth, async (req, res) => {
    const { id, field, newValue, description } = req.body;
    const userSignature = req.user.name || req.user.email;

    // Legacy multi-field path
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

    // Single-field path (new inline update form)
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

        currentDoc[field] = newValueStr;
        await currentDoc.save();

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

// Ingest Master Spreadsheet Route
router.post('/api/bookings/upload-dump', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Payload sheet missing." });
    try {
        const { model } = req.body;
        if (!model || (model !== 'retail' && model !== 'rental')) {
            return res.status(400).json({ error: "Booking model selection ('retail' or 'rental') is required." });
        }
        const originalName = req.file.originalname;
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
        const fileNameMatch = nameWithoutExt.match(/^(.+?)_dump_(\d{1,2}-\d{1,2}|\d{1,2}[A-Za-z]{3})$/i);
        const clientName = fileNameMatch ? fileNameMatch[1].trim() : "Unknown";

        const parseExcelDate = (val) => {
            if (!val) return "—";
            if (val instanceof Date && !isNaN(val)) {
                const y = val.getFullYear();
                const m = String(val.getMonth() + 1).padStart(2, '0');
                const d = String(val.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                if (!isNaN(date)) {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const d = String(date.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
            }
            if (typeof val === 'string') {
                const trimmed = val.trim();
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
                if (/^\d+(\.\d+)?$/.test(trimmed)) {
                    const date = new Date(Math.round((parseFloat(trimmed) - 25569) * 86400 * 1000));
                    if (!isNaN(date)) {
                        const y = date.getFullYear();
                        const m = String(date.getMonth() + 1).padStart(2, '0');
                        const d = String(date.getDate()).padStart(2, '0');
                        return `${y}-${m}-${d}`;
                    }
                }
                const ddmmyyyy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
                if (ddmmyyyy) {
                    const d = ddmmyyyy[1].padStart(2, '0');
                    const m = ddmmyyyy[2].padStart(2, '0');
                    const y = ddmmyyyy[3];
                    return `${y}-${m}-${d}`;
                }
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

        const parseExcelTime = (val) => {
            if (val === undefined || val === null || val === '') return "00:00";
            if (val instanceof Date && !isNaN(val)) {
                const timeStr = val.toLocaleTimeString('en-US', { hour12: false });
                const parts = timeStr.split(':');
                return `${parts[0]}:${parts[1]}`;
            }
            let num = typeof val === 'number' ? val : parseFloat(val);
            if (!isNaN(num) && typeof val !== 'string' || (typeof val === 'string' && /^0?\.\d+$/.test(val.trim()))) {
                const totalSeconds = Math.round(num * 24 * 60 * 60);
                const hours = Math.floor(totalSeconds / 3600) % 24;
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const h = String(hours).padStart(2, '0');
                const m = String(minutes).padStart(2, '0');
                return `${h}:${m}`;
            }
            if (typeof val === 'string') {
                const trimmed = val.trim();
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

        const zones = await Zone.find({});
        const getZoneForDistance = (km) => {
            if (km <= 0) return "—";
            const match = zones.find(z => km >= z.minKm && km <= z.maxKm);
            return match ? match.name : "—";
        };

        const rates = await Rate.find({});
        const ratesMap = {};
        rates.forEach(r => {
            ratesMap[r.zoneName.trim()] = r;
        });

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: false, raw: false });
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const normalizedRows = rawRows.map(row => {
            const cleanRow = {};
            for (const key in row) {
                const cleanKey = key.trim().replace(/\s+/g, ' ');
                cleanRow[cleanKey] = row[key];
            }
            return cleanRow;
        });

        let count = 0;
        const warnings = [];
        for (const row of normalizedRows) {
            const bId = row["Booking ID"];
            if (bId) {
                const pickupAddress = row["Pickup Address"] || "—";
                const dropAddress = row["Drop Address"] || "—";
                const distanceKm = parseFloat(row["Distance(KM)"]) || 0;
                const trimmedId = String(bId).trim();
                 if (distanceKm === 0) {
                    warnings.push(`Booking ${trimmedId} has a distance of 0 KM.`);
                }
                if (
                    pickupAddress.toLowerCase().includes('abu dhabi') || 
                    dropAddress.toLowerCase().includes('abu dhabi')
                ) {
                    warnings.push(`Booking ${trimmedId} contains "Abu Dhabi" in the address.`);
                }

                const existingDoc = await Booking.findOne({ bookingId: trimmedId });
                const isNew = !existingDoc;

                const serviceType = getServiceType(pickupAddress, dropAddress);
                const zone = getZoneForDistance(distanceKm);

                let amountAED = 0;
                const rate = ratesMap[zone];
                if (rate) {
                    if (serviceType === 'Pickup') {
                        amountAED = rate.pickupAmount;
                    } else if (serviceType === 'Drop') {
                        amountAED = rate.dropAmount;
                    }
                }

                const newValues = {
                    bookingId: trimmedId,
                    clientName: clientName,
                    model: model,
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
                    serviceType: serviceType,
                    zone: zone,
                    amountAED: amountAED,
                    bookingSource: "Portal",
                    customerName: row["Customer Name"] ? String(row["Customer Name"]).trim() : "—",
                    customerMobile: row["Customer Mobile"] ? String(row["Customer Mobile"]).trim() : "—",
                    pickUpRegion: row["Pick Up Region"] ? String(row["Pick Up Region"]).trim() : "—",
                    pickUpCountry: row["Pick Up Country"] ? String(row["Pick Up Country"]).trim() : "—",
                    pickUpZipcode: row["Pick Up Zipcode"] ? String(row["Pick Up Zipcode"]).trim() : "—",
                    dropRegion: row["Drop Region"] ? String(row["Drop Region"]).trim() : "—",
                    dropCountry: row["Drop Country"] ? String(row["Drop Country"]).trim() : "—",
                    dropZipcode: row["Drop Zipcode"] ? String(row["Drop Zipcode"]).trim() : "—"
                };

                let changesMade = {};
                if (!isNew) {
                    for (const key of Object.keys(newValues)) {
                        const oldVal = existingDoc[key];
                        const newVal = newValues[key];
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
        res.json({ success: true, message: `Successfully parsed and recorded ${count} entries for client "${clientName}".`, warnings: warnings });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Spreadsheet structure processing aborted." });
    }
});

// Appending Vendor Manifest Changes Route
router.post('/api/bookings/upload-vendor', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Payload sheet missing." });
    try {
        const originalName = req.file.originalname;
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
        const fileNameMatch = nameWithoutExt.match(/^(.+?)_confirm_(\d{1,2}-\d{1,2}|\d{1,2}[A-Za-z]{3})$/i);
        const vendorName = fileNameMatch ? fileNameMatch[1].trim() : "Unknown";

        const parseDriverDetails = (trimmed) => {
            if (!trimmed) return null;
            const match = trimmed.match(/^([^+\d]+)/);
            if (match) {
                const textVariable = match[0].trim().replace(/\s+/g, ' ');
                const remaining = trimmed.replace(match[0], "");
                const cleanPhoneVariable = remaining.trim().replace(/\s+/g, '');
                return { name: textVariable, phone: cleanPhoneVariable };
            }
            return null;
        };

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const normalizedRows = rawRows.map(row => {
            const cleanRow = {};
            for (const key in row) {
                const cleanKey = key.trim().replace(/\s+/g, ' ');
                cleanRow[cleanKey] = row[key];
            }
            return cleanRow;
        });

        let count = 0;
        for (const row of normalizedRows) {
            const bId = row["Ref. No"];
            if (bId) {
                const currentDoc = await Booking.findOne({ bookingId: String(bId).trim() });
                if (currentDoc) {
                    let changed = false;
                    let chauffeurAudit = '';

                    const driverDetailsRaw = row["Driver's Details"];
                    const incomingPlate = row["Plate Number"];
                    const { name: incomingChauffeur, phone: incomingPhone } = parseDriverDetails(driverDetailsRaw.trim());

                    if (incomingChauffeur && currentDoc.chauffeurName !== incomingChauffeur) {
                        const oldName = currentDoc.chauffeurName ? currentDoc.chauffeurName : '—';
                        currentDoc.chauffeurName = incomingChauffeur;
                        changed = true;
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
                    if (currentDoc.vendorName !== vendorName) {
                        currentDoc.vendorName = vendorName;
                        changed = true;
                    }

                    if (changed) {
                        let newAuditLines = "Chauffeur assigned by vendor upload";
                        if (chauffeurAudit) {
                            newAuditLines += `\n${chauffeurAudit}`;
                        }
                        await currentDoc.save();

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

module.exports = router;

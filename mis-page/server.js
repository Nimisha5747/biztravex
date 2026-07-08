const express = require('express');
const { connectDatabase } = require('../shared-backend/db');
const app = express();

const PORT = process.env.PORT || 4000;

connectDatabase('MIS Service');

app.use(express.json());
app.use(express.static('public'));

const Booking   = require('../shared-models/Booking');
const Chauffeur = require('../shared-models/Chauffeur');

// ── Helper: today's date string YYYY-MM-DD ──
const getToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ────────────────────────────────────────
// GET  /api/mis/stats
// Returns total bookings + today's counts by status
// ────────────────────────────────────────
app.get('/api/mis/stats', async (req, res) => {
    try {
        const today = getToday();
        // MTD: first day of current month
        const d = new Date();
        const mtdStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

        const [todayTotal, upcoming, cancelled, completed, inProgress, mtd] = await Promise.all([
            Booking.countDocuments({ pickUpDate: today }),
            Booking.countDocuments({ pickUpDate: today, status: 'Upcoming' }),
            Booking.countDocuments({ pickUpDate: today, status: 'Cancelled' }),
            Booking.countDocuments({ pickUpDate: today, status: 'Completed' }),
            Booking.countDocuments({ pickUpDate: today, status: 'Ride In Progress' }),
            Booking.countDocuments({ pickUpDate: { $gte: mtdStart, $lte: today } }),
        ]);
        res.json({ todayTotal, pending: upcoming, cancelled, completed, inProgress, mtd });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// GET  /api/mis/bookings/today
// Returns ALL of today's bookings sorted by time
// ────────────────────────────────────────
app.get('/api/mis/bookings/today', async (req, res) => {
    try {
        const today = getToday();
        const bookings = await Booking.find({ pickUpDate: today }).sort({ pickUpTime: 1 });
        res.json(bookings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// GET  /api/mis/bookings/status/:status
// Returns today's bookings filtered by a specific status
// ────────────────────────────────────────
app.get('/api/mis/bookings/status/:status', async (req, res) => {
    try {
        const today = getToday();
        const status = decodeURIComponent(req.params.status);
        const bookings = await Booking.find({ pickUpDate: today, status }).sort({ pickUpTime: 1 });
        res.json(bookings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// POST /api/mis/bookings/by-date
// Returns bookings for a given date + optional column filters
// Body: { date: "YYYY-MM-DD", filters: { clientName: "", serviceType: "", zone: "", status: "" } }
// ────────────────────────────────────────
app.post('/api/mis/bookings/by-date', async (req, res) => {
    try {
        const { date, filters } = req.body;
        let query = {};
        if (date) query.pickUpDate = date;
        if (filters) {
            Object.keys(filters).forEach(key => {
                if (filters[key]) {
                    const escaped = String(filters[key]).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    query[key] = { $regex: new RegExp(escaped, 'i') };
                }
            });
        }
        const bookings = await Booking.find(query).sort({ pickUpTime: 1 });
        res.json(bookings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// GET  /api/mis/chauffeurs
// Returns all active chauffeurs for the assignment dropdown
// ────────────────────────────────────────
app.get('/api/mis/chauffeurs', async (req, res) => {
    try {
        const chauffeurs = await Chauffeur.find({ status: 'Active' }).sort({ name: 1 });
        res.json(chauffeurs);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// PATCH /api/mis/bookings/:id/assign-chauffeur
// Assigns a chauffeur name + phone to a booking
// Body: { chauffeurName, chauffeurPhone }
// ────────────────────────────────────────
app.patch('/api/mis/bookings/:id/assign-chauffeur', async (req, res) => {
    try {
        const { chauffeurName, chauffeurPhone } = req.body;
        const booking = await Booking.findByIdAndUpdate(
            req.params.id,
            { chauffeurName, chauffeurPhone },
            { new: true }
        );
        if (!booking) return res.status(404).json({ error: 'Booking not found.' });
        res.json({ success: true, booking });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// PATCH /api/mis/bookings/:id/status
// Moves a booking to a new status (Upcoming, Ride In Progress, Completed, Cancelled)
// Body: { status: "Ride In Progress" }
// ────────────────────────────────────────
app.patch('/api/mis/bookings/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const allowed = ['Upcoming', 'Ride In Progress', 'Completed', 'Cancelled'];
        if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status value.' });

        const booking = await Booking.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );
        if (!booking) return res.status(404).json({ error: 'Booking not found.' });
        res.json({ success: true, booking });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// PATCH /api/mis/bookings/:id/payment
// Saves chargeable, secondPickupCharged, secondPickupAmount
// Body: { chargeable, secondPickupCharged, secondPickupAmount }
// ────────────────────────────────────────
app.patch('/api/mis/bookings/:id/payment', async (req, res) => {
    try {
        const { chargeable, secondPickupCharged, secondPickupAmount } = req.body;
        const update = { chargeable, secondPickupCharged };
        update.secondPickupAmount = secondPickupCharged === 'Yes' ? (Number(secondPickupAmount) || 0) : 0;
        const booking = await Booking.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!booking) return res.status(404).json({ error: 'Booking not found.' });
        res.json({ success: true, booking });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// PATCH /api/mis/bookings/:id/remark
// Appends a timestamped remark entry to a booking
// Body: { remark: "Text", author: "Name" }
// ────────────────────────────────────────

app.patch('/api/mis/bookings/:id/remark', async (req, res) => {
    try {
        const { remark, author } = req.body;
        if (!remark || !author) return res.status(400).json({ error: 'Remark and author are required.' });

        const timestamp  = new Date().toLocaleString('en-GB');
        const remarkLine = `[${timestamp}] ${author}: ${remark}`;

        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ error: 'Booking not found.' });

        const existing = (!booking.remarks || booking.remarks === '—') ? '' : booking.remarks + '\n';
        const updated  = await Booking.findByIdAndUpdate(
            req.params.id,
            { remarks: existing + remarkLine },
            { new: true }
        );
        res.json({ success: true, booking: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────────────
// POST /api/mis/bookings/manual
// Creates a new manual booking entry
// ────────────────────────────────────────
app.post('/api/mis/bookings/manual', async (req, res) => {
    try {
        const booking = new Booking({ ...req.body, bookingSource: 'Manual Entry' });
        await booking.save();
        res.status(201).json({ success: true, booking });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`MIS Service running on port ${PORT}`));

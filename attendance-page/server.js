const express = require('express');
const path = require('path');
const { connectDatabase } = require('../shared-backend/db');
const app = express();

const PORT = process.env.PORT || 5000;

connectDatabase('Attendance Service');

const Chauffeur = require('../shared-models/Chauffeur');
const Attendance = require('../shared-models/Attendance');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────
// Helper: get YYYY-MM-DD for today in local time
// ─────────────────────────────────────────────────
function getToday() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ─────────────────────────────────────────────────
// Helper: get YYYY-MM prefix for current month
// ─────────────────────────────────────────────────
function getMonthPrefix() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

// ─────────────────────────────────────────────────
// Helper: parse HH:MM to minutes since midnight
// ─────────────────────────────────────────────────
function toMinutes(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

// ─────────────────────────────────────────────────
// Helper: compute overtime minutes
// ─────────────────────────────────────────────────
function calcOvertime(status, enteredTimeHHMM) {
    if (status === 'Absent' || status === 'Leave') return 0;

    const enteredMin = toMinutes(enteredTimeHHMM);
    if (enteredMin === null) return 0;

    let scheduledEndMin;
    if (status === 'Present-Day') {
        // Shift ends at midnight = 1440 minutes (to avoid rollover bugs)
        scheduledEndMin = 1440;
    } else if (status === 'Present-Night') {
        // Night shift ends at 12:00 noon = 720 minutes
        scheduledEndMin = 720;
    } else {
        return 0;
    }

    const diff = scheduledEndMin - enteredMin;
    return diff < 0 ? Math.abs(diff) : 0;
}

// ─────────────────────────────────────────────────
// GET /api/attendance/chauffeurs-with-mtd
// Returns all active chauffeurs with their MTD attendance stats
// ─────────────────────────────────────────────────
app.get('/api/attendance/chauffeurs-with-mtd', async (req, res) => {
    try {
        const chauffeurs = await Chauffeur.find({ status: 'Active' }).lean();
        const monthPrefix = getMonthPrefix();

        const results = await Promise.all(chauffeurs.map(async (c) => {
            const records = await Attendance.find({
                chauffeurId: c._id,
                date: { $regex: `^${monthPrefix}` }
            }).lean();

            const mtd = {
                presentDay: records.filter(r => r.status === 'Present-Day').length,
                presentNight: records.filter(r => r.status === 'Present-Night').length,
                absent: records.filter(r => r.status === 'Absent').length,
                leave: records.filter(r => r.status === 'Leave').length,
                overtimeMinutes: records.reduce((sum, r) => sum + (r.overtimeMinutes || 0), 0)
            };

            // Check if today is already marked
            const today = getToday();
            const todayRecord = records.find(r => r.date === today);

            return {
                _id: c._id,
                name: c.name,
                mobileNo: c.mobileNo,
                mtd,
                todayStatus: todayRecord ? todayRecord.status : null,
                todayLastTime: todayRecord ? todayRecord.lastTimeIn : null
            };
        }));

        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────
// POST /api/attendance/mark-today
// Body: { chauffeurId, status }
// Marks or upserts today's attendance for a chauffeur
// ─────────────────────────────────────────────────
app.post('/api/attendance/mark-today', async (req, res) => {
    const { chauffeurId, status } = req.body;
    if (!chauffeurId || !status) return res.status(400).json({ error: 'chauffeurId and status required.' });

    const allowed = ['Present-Day', 'Present-Night', 'Absent', 'Leave'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

    try {
        const chauffeur = await Chauffeur.findById(chauffeurId).lean();
        if (!chauffeur) return res.status(404).json({ error: 'Chauffeur not found.' });

        const today = getToday();

        // Upsert: if already marked today, update status; reset overtime since time entry may no longer apply
        const record = await Attendance.findOneAndUpdate(
            { chauffeurId, date: today },
            {
                chauffeurId,
                chauffeurName: chauffeur.name,
                date: today,
                status,
                // Reset overtime when re-marking — user must re-enter last time
                overtimeMinutes: 0,
                lastTimeIn: null
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, record });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────
// POST /api/attendance/enter-last-time
// Body: { chauffeurId, lastTimeIn } (HH:MM)
// Calculates and stores overtime for today
// ─────────────────────────────────────────────────
app.post('/api/attendance/enter-last-time', async (req, res) => {
    const { chauffeurId, lastTimeIn } = req.body;
    if (!chauffeurId || !lastTimeIn) return res.status(400).json({ error: 'chauffeurId and lastTimeIn required.' });

    try {
        const today = getToday();
        const record = await Attendance.findOne({ chauffeurId, date: today });

        if (!record) {
            return res.status(400).json({
                error: "Today's attendance has not been marked yet. Please mark attendance first."
            });
        }

        const overtimeMinutes = calcOvertime(record.status, lastTimeIn);

        record.lastTimeIn = lastTimeIn;
        record.overtimeMinutes = overtimeMinutes;
        await record.save();

        res.json({ success: true, record, overtimeMinutes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────
// GET /api/attendance/history/:chauffeurId
// Returns all attendance records for a chauffeur (for audit/detail view)
// ─────────────────────────────────────────────────
app.get('/api/attendance/history/:chauffeurId', async (req, res) => {
    try {
        const records = await Attendance.find({ chauffeurId: req.params.chauffeurId })
            .sort({ date: -1 })
            .lean();
        res.json(records);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Attendance Service running on http://localhost:${PORT}`));

const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    chauffeurId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chauffeur', required: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD (local date)
    status: { type: String, required: true, enum: ['Present-Day', 'Present-Night', 'Absent', 'Leave', 'Weekly-Off'] },
    overtimeMinutes: { type: Number, default: 0 }
});

// Ensure a chauffeur can have only one attendance record per day
AttendanceSchema.index({ chauffeurId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema, 'attendance');

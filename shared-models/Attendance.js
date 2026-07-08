const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    chauffeurId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chauffeur', required: true },
    chauffeurName: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    status: {
        type: String,
        enum: ['Present-Day', 'Present-Night', 'Absent', 'Leave'],
        required: true
    },
    lastTimeIn: { type: String, default: null }, // HH:MM, the actual clock-out / end time entered
    overtimeMinutes: { type: Number, default: 0 }
}, { timestamps: true });

// Unique compound index so only one record per chauffeur per day
AttendanceSchema.index({ chauffeurId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema, 'Attendance');

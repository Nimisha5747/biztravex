const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
    bookingId:   { type: String, required: true },
    timestamp:   { type: Date, default: Date.now },
    updatedBy:   { type: String, required: true },
    action:      { type: String, required: true },
    description: { type: String, default: '' },   // Remarks / reason for change
    changesMade: { type: Object, default: {} }     // Stores exact before/after field value maps
});

// Explicitly forces connection targeting to your exact tracking collection
module.exports = mongoose.model('BookingActivityLog', ActivityLogSchema, 'booking_activity_logs');

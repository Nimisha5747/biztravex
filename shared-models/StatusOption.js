const mongoose = require('mongoose');

const StatusOptionSchema = new mongoose.Schema({
    optionValue: { type: String, required: true, unique: true } // e.g., "Pending", "Self-Served", "Flight Delayed"
});

module.exports = mongoose.model('StatusOption', StatusOptionSchema, 'status_options');
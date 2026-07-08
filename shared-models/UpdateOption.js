const mongoose = require('mongoose');

const UpdateOptionSchema = new mongoose.Schema({
    optionValue: { type: String, required: true, unique: true } // e.g., "Driver Dispatched", "Passenger Onboard"
});

module.exports = mongoose.model('UpdateOption', UpdateOptionSchema, 'update_options');
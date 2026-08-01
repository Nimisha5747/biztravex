const mongoose = require('mongoose');

const RateSchema = new mongoose.Schema({
    zoneName: { type: String, required: true, unique: true },
    pickupAmount: { type: Number, required: true, default: 0 },
    dropAmount: { type: Number, required: true, default: 0 }
});

module.exports = mongoose.model('Rate', RateSchema, 'rates');

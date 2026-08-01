const mongoose = require('mongoose');

const ZoneSchema = new mongoose.Schema({
    name: { type: String, required: true },       // e.g. "Zone A"
    minKm: { type: Number, required: true, default: 0 },  // e.g. 0
    maxKm: { type: Number, required: true },               // e.g. 15
});

// Targets the global 'Zones' collection
module.exports = mongoose.model('Zone', ZoneSchema, 'Zone');

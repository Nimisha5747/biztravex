const mongoose = require('mongoose');

const ClientRateSchema = new mongoose.Schema({
    clientName: { type: String, required: true }, // References Client.name
    zoneName: { type: String, required: true },   // References Zone.zoneName
    pickupAmount: { type: Number, required: true, default: 0 }, // Contracted price for inbound runs
    dropAmount: { type: Number, required: true, default: 0 },   // Contracted price for outbound runs
    createdAt: { type: Date, default: Date.now }
});

// Enforces a compound unique index so a client cannot have duplicate rules for the same zone
ClientRateSchema.index({ clientName: 1, zoneName: 1 }, { unique: true });

module.exports = mongoose.model('ClientRate', ClientRateSchema, 'client_rates');
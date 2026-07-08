const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: ['B2B Corporate', 'B2C Retail VIP', 'Hotel Partnership'], required: true },
    mobileNo: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Client', ClientSchema, 'clients');
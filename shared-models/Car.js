const mongoose = require('mongoose');

const CarSchema = new mongoose.Schema({
    name: { type: String, required: true },       // e.g., "Lexus ES350"
    number: { type: String, required: true, unique: true }, // e.g., "DXB-X-4422"
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Car', CarSchema, 'Cars');
const mongoose = require('mongoose');

const VendorSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // e.g., "Apex Rent A Car"
    type: { type: String, enum: ['Primary Supplier', 'Secondary Chauffeur Supply', 'Luxury Limousines Depot'], required: true },
    mobileNo: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vendor', VendorSchema, 'vendors');
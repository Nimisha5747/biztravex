const mongoose = require('mongoose');

const ChauffeurSchema = new mongoose.Schema({
    name: { type: String, required: true },
    mobileNo: { type: String, required: true },
    status: { type: String, default: 'Active' }
});

module.exports = mongoose.model('Chauffeur', ChauffeurSchema, 'Chauffeurs');
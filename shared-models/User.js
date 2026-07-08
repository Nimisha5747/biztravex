const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    mobileNo: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ['Admin', 'Editor', 'Viewer'], required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema, 'users');
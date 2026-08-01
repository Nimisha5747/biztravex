const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Chauffeur = require('../models/Chauffeur');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ── Auth Routes ─────────────────────────────────────────────────────────
router.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await new User({
            email: email.toLowerCase().trim(),
            passwordHash,
            name: name || '',
            role: 'admin',
            number: ''
        }).save();

        res.json({ success: true, message: 'Account created. Please log in.', userId: user._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

router.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

        if (user.role === 'chauffeur') {
            return res.status(403).json({ error: 'Chauffeurs must log in through the Chauffeur Portal.' });
        }

        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

        const token = jwt.sign({ userId: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ success: true, token, user: { email: user.email, name: user.name, role: user.role, number: user.number } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed.' });
    }
});

router.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

router.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: { email: user.email, name: user.name, role: user.role, number: user.number } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to retrieve profile.' });
    }
});

module.exports = router;

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

// ── Admin User Management (CRM admins only) ─────────────────────────────────

// List all admin users
// Uses $in to catch users where role = 'admin' OR role field is missing/null
// (covers accounts added directly to MongoDB or created before the role field existed)
router.get('/api/admin/users', requireAuth, async (req, res) => {
    try {
        const users = await User.find({
            $or: [
                { role: 'admin' },
                { role: { $exists: false } },
                { role: null }
            ]
        })
            .select('_id email name createdAt role')
            .sort({ createdAt: 1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch admin users.' });
    }
});

// Create a new admin user
router.post('/api/admin/users', requireAuth, async (req, res) => {
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
            name: name ? name.trim() : '',
            role: 'admin'
        }).save();

        res.json({ success: true, user: { _id: user._id, email: user.email, name: user.name, createdAt: user.createdAt } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create admin user.' });
    }
});

// ───────────────────────────────────────────────────────────────────────────────
// REPLACE 'xyz@example.com' below with the actual privileged admin email.
// Only this account can remove other admin users.
const SUPER_ADMIN_EMAIL = 'xyz@example.com';
// ───────────────────────────────────────────────────────────────────────────────

// Delete an admin user — only SUPER_ADMIN_EMAIL may do this
router.delete('/api/admin/users/:id', requireAuth, async (req, res) => {
    try {
        // Only the privileged super-admin email may delete other admins
        if (req.user.email !== SUPER_ADMIN_EMAIL) {
            return res.status(403).json({ error: 'Only the designated super-admin may remove admin accounts.' });
        }
        if (req.params.id === req.user.userId) {
            return res.status(400).json({ error: 'You cannot remove your own account.' });
        }
        const deleted = await User.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'User not found.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete admin user.' });
    }
});

module.exports = router;

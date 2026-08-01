const express = require('express');
const Zone = require('../models/Zone');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/api/zones', requireAuth, async (req, res) => {
    try {
        const zones = await Zone.find({}).sort({ minKm: 1 });
        res.json(zones);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch zones.' });
    }
});

router.post('/api/zones', requireAuth, async (req, res) => {
    try {
        const { name, minKm, maxKm } = req.body;
        if (!name || minKm === undefined || maxKm === undefined) {
            return res.status(400).json({ error: 'name, minKm and maxKm are required.' });
        }
        const min = parseFloat(minKm);
        const max = parseFloat(maxKm);
        if (isNaN(min) || isNaN(max)) {
            return res.status(400).json({ error: 'minKm and maxKm must be numbers.' });
        }
        if (max < min) {
            return res.status(400).json({ error: 'maxKm must be greater than or equal to minKm.' });
        }

        const zone = new Zone({ name: String(name).trim(), minKm: min, maxKm: max });
        await zone.save();
        res.json({ success: true, zone });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create zone.' });
    }
});

router.delete('/api/zones/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await Zone.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Zone not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete zone.' });
    }
});

module.exports = router;

const express = require('express');
const Rate = require('../models/Rate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/api/rates', requireAuth, async (req, res) => {
    try {
        const rates = await Rate.find({}).sort({ zoneName: 1 });
        res.json(rates);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch rates.' });
    }
});

router.post('/api/rates', requireAuth, async (req, res) => {
    try {
        const { zoneName, pickupAmount, dropAmount } = req.body;
        if (!zoneName || pickupAmount === undefined || dropAmount === undefined) {
            return res.status(400).json({ error: 'zoneName, pickupAmount and dropAmount are required.' });
        }
        const pickup = parseFloat(pickupAmount);
        const drop = parseFloat(dropAmount);
        if (isNaN(pickup) || isNaN(drop)) {
            return res.status(400).json({ error: 'pickupAmount and dropAmount must be numbers.' });
        }

        // Upsert rate by zoneName
        const rate = await Rate.findOneAndUpdate(
            { zoneName: String(zoneName).trim() },
            { pickupAmount: pickup, dropAmount: drop },
            { upsert: true, new: true }
        );

        res.json({ success: true, rate });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save rate.' });
    }
});

router.delete('/api/rates/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await Rate.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Rate not found.' });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete rate.' });
    }
});

module.exports = router;

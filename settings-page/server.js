const express = require('express');
const { connectDatabase } = require('../shared-backend/db');
const app = express();

const PORT = process.env.PORT || 8000;

connectDatabase('Settings Service');

app.use(express.json());
app.use(express.static('public'));

// Load Centralized Architecture Models Layer
const models = {
    zone: require('../shared-models/Zone'),
    chauffeur: require('../shared-models/Chauffeur'),
    car: require('../shared-models/Car'),
    user: require('../shared-models/User'),
    client: require('../shared-models/Client'),
    vendor: require('../shared-models/Vendor'),
    clientrate: require('../shared-models/ClientRate'),
    statusoption: require('../shared-models/StatusOption'),
    updateoption: require('../shared-models/UpdateOption')
};

// Dynamic Bulk Generic Registry Retrieval Route
app.get('/api/settings/:collectionType', async (req, res) => {
    const target = req.params.collectionType.toLowerCase();
    if (!models[target]) return res.status(400).json({ error: "Invalid schema mapping assignment type." });
    try {
        const rows = await models[target].find({});
        res.json(rows);
    } catch (e) { res.status(500).json({ error: "Query execution error." }); }
});

// Dynamic Registry Write Row Record Route
app.post('/api/settings/:collectionType/new', async (req, res) => {
    const target = req.params.collectionType.toLowerCase();
    if (!models[target]) return res.status(400).json({ error: "Invalid target routing parameter reference." });
    try {
        const documentPayload = new models[target](req.body);
        await documentPayload.save();
        res.status(201).json({ success: true, doc: documentPayload });
    } catch (e) {
        console.error("Save error:", e);
        res.status(500).json({ error: "Failed to persist document configuration row. Details: " + e.message });
    }
});

// Dynamic Resource Removal Row Deletion Route
app.delete('/api/settings/:collectionType/:id', async (req, res) => {
    const target = req.params.collectionType.toLowerCase();
    if (!models[target]) return res.status(400).json({ error: "Invalid context operational parameters allocation." });
    try {
        await models[target].findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Index collection cleanup loop faulted." }); }
});

app.listen(PORT, () => console.log(`Master Settings service controller running online on port ${PORT}`));

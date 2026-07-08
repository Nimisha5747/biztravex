const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

function loadRootEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        const separatorIndex = trimmed.indexOf('=');
        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (!key || process.env[key] !== undefined) continue;

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

async function connectDatabase(serviceName) {
    loadRootEnvFile();

    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
        console.error(`${serviceName} cannot start: MONGO_URI environment variable is missing.`);
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log(`${serviceName} connected to MongoDB.`);
    } catch (err) {
        console.error(`${serviceName} database connection error:`, err);
        process.exit(1);
    }
}

module.exports = { connectDatabase };

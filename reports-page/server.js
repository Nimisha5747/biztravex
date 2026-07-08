const express = require('express');
const path = require('path');
const { connectDatabase } = require('../shared-backend/db');
const app = express();

const PORT = process.env.PORT || 7000;

connectDatabase('Reports Service');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Reports Service running on http://localhost:${PORT}`));

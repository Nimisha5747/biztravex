const express = require('express');
const app = express();

const PORT = process.env.PORT || 4001;

app.use(express.json());
app.use(express.static('public'));

// ── Health check ──────────────────────────────────────
app.get('/api/expense/health', (req, res) => {
    res.json({ status: 'ok', service: 'Expense Service', port: PORT });
});

app.listen(PORT, () => console.log(`Expense Service running on http://localhost:${PORT}`));

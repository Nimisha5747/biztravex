const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const cookieSession = require('cookie-session');
const path = require('path');
const { connectDatabase } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDatabase('CRM Service');

// Configure global middlewares
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(
  cookieSession({
    name: 'biztravex_session',
    keys: [process.env.SESSION_SECRET || 'biztravex_default_secret_key'],
    maxAge: 13 * 60 * 60 * 1000,
  })
);

// Serve unified static assets
app.use(express.static('public'));

// Import and mount routes
const authRouter = require('./routes/auth');
const bookingsRouter = require('./routes/bookings');
const zonesRouter = require('./routes/zones');
const chauffeurRouter = require('./routes/chauffeur');
const ratesRouter = require('./routes/rates');
const { router: chauffeurAdminRouter } = require('./routes/admin');

app.use('/', authRouter);
app.use('/', bookingsRouter);
app.use('/', zonesRouter);
app.use('/', chauffeurRouter);
app.use('/', ratesRouter);
app.use('/api/admin', chauffeurAdminRouter);

// Start server
app.listen(PORT, () => console.log(`CRM UI Application framework runtime online on port ${PORT}`));

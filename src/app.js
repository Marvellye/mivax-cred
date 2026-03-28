const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { SESSIONS_DIR, ANALYTICS_DIR } = require('./config');
const routes = require('./routes');
const trackTraffic = require('./middleware/analytics');

const app = express();

app.use(cors());
app.use(express.json());
app.use(trackTraffic);

// Ensure sessions and analytics directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}
if (!fs.existsSync(ANALYTICS_DIR)) {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
}

app.use('/', routes);

module.exports = app;

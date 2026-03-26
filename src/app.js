const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { SESSIONS_DIR } = require('./config');
const routes = require('./routes');

const app = express();

app.use(cors());
app.use(express.json());

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

app.use('/', routes);

module.exports = app;

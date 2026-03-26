const fs = require('fs');
const path = require('path');
const { SESSIONS_DIR } = require('../config');
const { SessionExpiredError } = require('../services/session_service');

function handleRouteError(err, sessionId, res) {
  if (err instanceof SessionExpiredError) {
    const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
    return res.status(401).json({ error: 'Session expired' });
  }
  res.status(500).json({ error: err.message });
}

module.exports = {
  handleRouteError
};

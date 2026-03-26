const fs = require('fs');
const path = require('path');
const { SESSIONS_DIR } = require('../config');

class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
    this.status = 401;
  }
}

function getAuthHeaders(sessionId) {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) return null;

  const storage = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

  const cookieStr = storage.cookies
    .filter(c => c.domain.includes('miva.university'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  return {
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  };
}

function getSISAuthHeaders(sessionId) {
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) return null;

  const storage = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

  // Fallback to empty origins if not available
  const origins = storage.origins || [];
  const sisOrigin = origins.find(o => o.origin === 'https://sis.miva.university') || {};
  const localStorage = sisOrigin.localStorage || [];
  
  const authStorage = localStorage.find(item => item.name === 'auth-storage');
  if (!authStorage) {
      // Sometimes it might be under the main origin login
      // But based on the user request, it's explicitly in sis.miva.university
      return null;
  }

  try {
    const authData = JSON.parse(authStorage.value);
    const token = authData.state?.access_token;

    if (!token) return null;

    return {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-origin-portal': 'student',
        'dnt': '1'
      }
    };
  } catch (e) {
    return null;
  }
}

module.exports = {
  SessionExpiredError,
  getAuthHeaders,
  getSISAuthHeaders
};

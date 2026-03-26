const { BASE_URL } = require('../config');

function proxyImg(url, sessionId) {
  if (!url) return null;
  return `${BASE_URL}/img/${Buffer.from(url).toString('base64')}/${sessionId}`;
}

module.exports = { proxyImg };

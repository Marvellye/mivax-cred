const axios = require('axios');
const { getAuthHeaders } = require('../services/session_service');

const proxyImg = async (req, res) => {
  let imageUrl;
  try {
    imageUrl = Buffer.from(req.params.base64url, 'base64').toString('utf8');
    if (!imageUrl.startsWith('http')) {
      return res.status(400).json({ error: 'Invalid image URL' });
    }
  } catch {
    return res.status(400).json({ error: 'Failed to decode URL' });
  }

  const auth = getAuthHeaders(req.params.sessionId);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://lms.miva.university/',
    ...(auth ? auth.headers : {})
  };

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      headers,
      timeout: 15000
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // cache for 1 day
    response.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch image', details: err.message });
  }
};

module.exports = {
  proxyImg
};

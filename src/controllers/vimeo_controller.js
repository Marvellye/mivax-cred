const vimeoService = require('../services/vimeo_service');

const getMeta = async (req, res) => {
  try {
    const meta = await vimeoService.getVimeoMeta(req.params.videoId);
    res.json(meta);
  } catch (err) {
    res.status(502).json({ error: 'vimeo metadata fetch failed', details: err.message });
  }
};

const getTranscript = async (req, res) => {
  try {
    const t = await vimeoService.getVimeoTranscript(req.params.videoId);
    res.json(t);
  } catch (err) {
    res.status(502).json({ error: 'vimeo transcript fetch failed', details: err.message });
  }
};

module.exports = { getMeta, getTranscript };

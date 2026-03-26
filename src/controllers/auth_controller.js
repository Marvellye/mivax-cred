const crawlerService = require('../services/crawler_service');

const login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const sessionId = await crawlerService.login(username, password);
    res.json({ sessionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  login
};

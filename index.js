require('dotenv').config();
const app = require('./src/app');
const { PORT } = require('./src/config');

app.listen(PORT, () => {
  console.log(`Hybrid Scraper Server running on http://localhost:${PORT}`);
});

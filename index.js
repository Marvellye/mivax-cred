require('dotenv').config();
const app = require('./src/app');
const { PORT } = require('./src/config');
app.set('trust proxy', true);

app.listen(PORT, () => {
  console.log(`MivaX Server running on http://localhost:${PORT}`);
});

const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL || 'https://mivax.marvelly.com.ng/', // fallback for current logic
  SIS_BASE_URL: 'https://sis-be.miva.university',
  SESSIONS_DIR: path.join(__dirname, '../../sessions'),
};

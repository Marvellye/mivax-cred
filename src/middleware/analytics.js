const fs = require('fs');
const path = require('path');
const { ANALYTICS_DIR } = require('../config');

// Ensure analytics directory exists
if (!fs.existsSync(ANALYTICS_DIR)) {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
}

/**
 * Middleware for tracking traffic.
 * Logs method, path, status, response time, and optional session ID.
 */
const trackTraffic = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    try {
      const duration = Date.now() - start;

      const method = req.method;
      const originalUrl = req.originalUrl;
      const headers = req.headers || {};
      const statusCode = res.statusCode;

      // Safe IP extraction
      const ip =
        req.ip ||
        req.headers?.['x-forwarded-for'] ||
        req.socket?.remoteAddress ||
        null;

      // Safe sessionId extraction
      const sessionId =
        req.params?.sessionId ||
        req.path?.split('/')?.filter(p => p.length > 20)?.pop() ||
        null;

      const analyticsData = {
        timestamp: new Date().toISOString(),
        method,
        path: originalUrl,
        status: statusCode,
        duration: `${duration}ms`,
        ip,
        userAgent: headers['user-agent'] || null,
        sessionId
      };

      // Construct filename based on current date
      const dateStr = new Date().toISOString().split('T')[0];
      const logFile = path.join(ANALYTICS_DIR, `traffic-${dateStr}.jsonl`);

      const logData = JSON.stringify(analyticsData) + '\n';

      // Async write (non-blocking)
      fs.appendFile(logFile, logData, (err) => {
        if (err) {
          console.error('Failed to log analytics:', err);
        }
      });

    } catch (err) {
      // Prevent ANY crash from middleware
      console.error('Analytics middleware error:', err);
    }
  });

  next();
};

module.exports = trackTraffic;
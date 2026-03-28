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
const trackTraffic = async (req, res, next) => {
  const start = Date.now();
  
  // To capture the response body and status, we need to wrap res.end or use an event
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl, ip, headers } = req;
    const { statusCode } = res;
    
    // Simple filter for "important" data
    const analyticsData = {
      timestamp: new Date().toISOString(),
      method,
      path: originalUrl,
      status: statusCode,
      duration: `${duration}ms`,
      ip: ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: headers['user-agent'],
      // Extract sessionId if it exists in the path (typically the last segment in this API)
      sessionId: req.params.sessionId || req.path.split('/').filter(p => p.length > 20).pop() || null
    };

    // Construct filename based on current date
    const dateStr = new Date().toISOString().split('T')[0];
    const logFile = path.join(ANALYTICS_DIR, `traffic-${dateStr}.jsonl`);

    // Append to file (JSON Lines format) - using async for better performance
    const logData = JSON.stringify(analyticsData) + '\n';
    fs.appendFile(logFile, logData, (err) => {
      if (err) {
        console.error('Failed to log analytics (async):', err);
      }
    });
  });

  next();
};

module.exports = trackTraffic;

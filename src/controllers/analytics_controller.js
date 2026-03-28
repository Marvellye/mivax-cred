const fs = require('fs');
const path = require('path');
const { ANALYTICS_DIR } = require('../config');

/**
 * Controller for simple analytics visualization (optional use)
 */
const getSummary = async (req, res) => {
  try {
    const files = fs.readdirSync(ANALYTICS_DIR).filter(f => f.endsWith('.jsonl'));
    if (files.length === 0) {
      return res.json({ message: 'No analytics data found.' });
    }

    // Get the latest log file
    const latestFile = files.sort().reverse()[0];
    const filePath = path.join(ANALYTICS_DIR, latestFile);
    
    // Read the log file and parse entries (streaming or reading tail for large files would be better)
    let content = fs.readFileSync(filePath, 'utf8');
    let entries = content.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    // If there are too many entries, just take the last 2000 for the summary
    if (entries.length > 2000) {
      entries = entries.slice(-2000);
    }
    // Create a basic summary
    const summary = {
      totalRequests: entries.length,
      successfulRequests: entries.filter(e => e.status >= 200 && e.status < 300).length,
      failedRequests: entries.filter(e => e.status >= 400).length,
      topPaths: entries.reduce((acc, e) => {
        acc[e.path] = (acc[e.path] || 0) + 1;
        return acc;
      }, {}),
      byStatus: entries.reduce((acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
      }, {}),
    };

    // Sort top paths for the top 5
    summary.topPaths = Object.entries(summary.topPaths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((acc, [path, count]) => {
        acc[path] = count;
        return acc;
      }, {});

    res.json({ date: latestFile.replace('traffic-', '').replace('.jsonl', ''), summary, recentRequests: entries.slice(-10).reverse() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getSummary
};

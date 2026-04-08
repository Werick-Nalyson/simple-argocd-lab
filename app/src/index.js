const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || '1.0.0';
const START_TIME = Date.now();

app.get('/', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({
    message: 'Hello from ArgoCD Lab! 1',
    version: VERSION,
    hostname: os.hostname(),
    uptime: `${uptimeSeconds}s`,
    platform: os.platform(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} | version ${VERSION}`);
});

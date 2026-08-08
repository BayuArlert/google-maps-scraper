const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Regular scraping endpoints
router.post('/scrape', scraperController.scrapeSingle);
router.post('/scrape-multiple', scraperController.scrapeMultiple);

// Session endpoints
router.post('/scrape-session', scraperController.startSession);
router.get('/scrape-session', scraperController.getAllSessions);
router.get('/scrape-session/:sessionId/status', scraperController.getSessionStatus);
router.get('/scrape-session/:sessionId/results', scraperController.getSessionResults);
router.get('/scrape-session/:sessionId/download', scraperController.downloadSessionResults);
router.post('/scrape-session/:sessionId/stop', scraperController.stopSession);
router.post('/scrape-session/:sessionId/resume', scraperController.resumeSession);
router.delete('/scrape-session/:sessionId', scraperController.deleteSession);

module.exports = router;
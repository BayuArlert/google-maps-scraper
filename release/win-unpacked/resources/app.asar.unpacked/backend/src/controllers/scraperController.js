const scraperService = require('../services/scraperService');
const sessionService = require('../services/sessionService');

class ScraperController {
  async scrapeSingle(req, res) {
    try {
      const { keyword, location, maxResults, options } = req.body;

      if (!keyword) {
        return res.status(400).json({ 
          error: 'Keyword is required' 
        });
      }

      const results = await scraperService.scrapeGoogleMaps(
        keyword, 
        location || '', 
        maxResults || 0,  // 0 means no limit
        options || {}
      );

      res.json({
        success: true,
        keyword,
        count: results.length,
        data: results
      });

    } catch (error) {
      console.error('Controller error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async scrapeMultiple(req, res) {
    try {
      const { keywords } = req.body;

      if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ 
          error: 'Keywords array is required' 
        });
      }

      const results = await scraperService.scrapeMultipleKeywords(keywords);

      res.json({
        success: true,
        totalKeywords: keywords.length,
        data: results
      });

    } catch (error) {
      console.error('Controller error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // Session endpoints
  async startSession(req, res) {
    try {
      const { keywords, keyword, location, maxResults, options } = req.body;

      const keywordList = (() => {
        if (Array.isArray(keywords)) return keywords;
        if (keyword) return [keyword];
        return [];
      })().map(item => (item || '').toString().trim()).filter(Boolean);

      if (keywordList.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Minimal harus ada satu keyword untuk memulai scraping session.'
        });
      }

      const session = await sessionService.createSession(
        keywordList,
        location || '',
        maxResults || 0,
        options || {}
      );

      scraperService.scrapeGoogleMapsWithSession(session.sessionId)
        .catch(error => {
          console.error(`Session ${session.sessionId} error:`, error);
        });

      res.json({
        success: true,
        sessionId: session.sessionId,
        message: 'Session started',
        session: sessionService.getSessionStatus(session.sessionId)
      });

    } catch (error) {
      console.error('Start session error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getSessionStatus(req, res) {
    try {
      const { sessionId } = req.params;

      const status = sessionService.getSessionStatus(sessionId);
      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Session not found'
        });
      }

      res.json({
        success: true,
        status
      });

    } catch (error) {
      console.error('Get session status error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getSessionResults(req, res) {
    try {
      const { sessionId } = req.params;

      const session = sessionService.getSession(sessionId);
      if (!session) {
        // Try to load from file
        const loadedSession = await sessionService.loadSession(sessionId);
        if (!loadedSession) {
          return res.status(404).json({
            success: false,
            error: 'Session not found'
          });
        }
        
        return res.json({
          success: true,
          sessionId: loadedSession.sessionId,
          keywords: loadedSession.keywords,
          currentKeywordIndex: loadedSession.currentKeywordIndex,
          location: loadedSession.location,
          status: loadedSession.status,
          count: loadedSession.results.length,
          data: loadedSession.results
        });
      }

      res.json({
        success: true,
        sessionId: session.sessionId,
        keywords: session.keywords,
        currentKeywordIndex: session.currentKeywordIndex,
        location: session.location,
        status: session.status,
        count: session.results.length,
        data: session.results
      });

    } catch (error) {
      console.error('Get session results error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async downloadSessionResults(req, res) {
    try {
      const { sessionId } = req.params;
      const { format = 'json' } = req.query;

      const session = sessionService.getSession(sessionId);
      if (!session) {
        const loadedSession = await sessionService.loadSession(sessionId);
        if (!loadedSession) {
          return res.status(404).json({
            success: false,
            error: 'Session not found'
          });
        }
        
        const results = loadedSession.results;
        
        if (format === 'csv') {
          // Convert to CSV
          const csv = this.convertToCSV(results);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename=session-${sessionId}-${Date.now()}.csv`);
          return res.send(csv);
        } else {
          // JSON format
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename=session-${sessionId}-${Date.now()}.json`);
          return res.json({
            sessionId: loadedSession.sessionId,
            keywords: loadedSession.keywords,
            currentKeywordIndex: loadedSession.currentKeywordIndex,
            location: loadedSession.location,
            status: loadedSession.status,
            count: results.length,
            data: results
          });
        }
      }

      const results = session.results;

      if (format === 'csv') {
        const csv = this.convertToCSV(results);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=session-${sessionId}-${Date.now()}.csv`);
        return res.send(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=session-${sessionId}-${Date.now()}.json`);
        return res.json({
          sessionId: session.sessionId,
          keywords: session.keywords,
          currentKeywordIndex: session.currentKeywordIndex,
          location: session.location,
          status: session.status,
          count: results.length,
          data: results
        });
      }

    } catch (error) {
      console.error('Download session results error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async stopSession(req, res) {
    try {
      const { sessionId } = req.params;

      const session = await sessionService.stopSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found'
        });
      }

      // Stop browser if running
      scraperService.stopSession(sessionId);

      res.json({
        success: true,
        message: 'Session stopped',
        session: sessionService.getSessionStatus(sessionId)
      });

    } catch (error) {
      console.error('Stop session error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async resumeSession(req, res) {
    try {
      const { sessionId } = req.params;

      const session = await sessionService.resumeSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found'
        });
      }

      // Resume scraping in background
      scraperService.scrapeGoogleMapsWithSession(sessionId)
        .catch(error => {
          console.error(`Session ${sessionId} resume error:`, error);
        });

      res.json({
        success: true,
        message: 'Session resumed',
        session: sessionService.getSessionStatus(sessionId)
      });

    } catch (error) {
      console.error('Resume session error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getAllSessions(req, res) {
    try {
      await sessionService.loadAllSessions();
      const sessions = sessionService.getAllSessions();

      res.json({
        success: true,
        count: sessions.length,
        sessions
      });

    } catch (error) {
      console.error('Get all sessions error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async deleteSession(req, res) {
    try {
      const { sessionId } = req.params;

      const deleted = await sessionService.deleteSession(sessionId);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Session not found'
        });
      }

      res.json({
        success: true,
        message: 'Session deleted'
      });

    } catch (error) {
      console.error('Delete session error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  convertToCSV(data) {
    if (!data || data.length === 0) {
      return 'name,rating,address,phone\n';
    }

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(item => {
      return Object.values(item).map(val => {
        // Escape commas and quotes in CSV
        const stringVal = String(val || '').replace(/"/g, '""');
        return `"${stringVal}"`;
      }).join(',');
    });

    return [headers, ...rows].join('\n');
  }
}

module.exports = new ScraperController();
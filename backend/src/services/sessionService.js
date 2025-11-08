const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SESSIONS_DIR = path.join(__dirname, '../../sessions');

class SessionService {
  constructor() {
    this.sessions = new Map();
    this.ensureSessionsDir();
  }

  async ensureSessionsDir() {
    try {
      await fs.mkdir(SESSIONS_DIR, { recursive: true });
    } catch (error) {
      console.error('Error creating sessions directory:', error);
    }
  }

  normalizeKeywords(keywordsInput, fallbackKeyword) {
    let keywords = [];

    if (Array.isArray(keywordsInput)) {
      keywords = keywordsInput;
    } else if (typeof keywordsInput === 'string') {
      keywords = [keywordsInput];
    }

    if ((!keywords || keywords.length === 0) && fallbackKeyword) {
      keywords = [fallbackKeyword];
    }

    return keywords
      .map(keyword => (keyword || '').toString().trim())
      .filter(Boolean);
  }

  createKeywordSummaries(keywords) {
    const timestamp = new Date().toISOString();
    return keywords.map(keyword => ({
      keyword,
      status: 'pending', // pending, running, completed, stopped
      totalFound: 0,
      processed: 0,
      lastUpdate: timestamp,
    }));
  }

  async createSession(keywordsInput, location = '', maxResults = 0, options = {}) {
    const keywords = this.normalizeKeywords(keywordsInput);
    if (keywords.length === 0) {
      throw new Error('Minimal harus ada satu keyword untuk memulai session.');
    }

    const sessionId = uuidv4();
    const timestamp = new Date().toISOString();

    const session = {
      sessionId,
      keywords,
      totalKeywords: keywords.length,
      location,
      maxResults,
      options,
      status: 'running', // running, stopped, completed
      startTime: timestamp,
      lastUpdate: timestamp,
      endTime: null,
      currentKeywordIndex: 0,
      currentKeyword: keywords[0],
      currentIndex: 0,
      totalFound: 0,
      results: [],
      errors: [],
      keywordSummaries: this.createKeywordSummaries(keywords),
    };

    this.sessions.set(sessionId, session);
    await this.saveSession(session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async updateSession(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updatedSession = {
      ...session,
      ...updates,
      lastUpdate: new Date().toISOString(),
    };

    this.sessions.set(sessionId, updatedSession);
    await this.saveSession(updatedSession);
    return updatedSession;
  }

  async stopSession(sessionId) {
    const timestamp = new Date().toISOString();
    const session = await this.updateSession(sessionId, {
      status: 'stopped',
      endTime: timestamp,
    });

    if (session.keywordSummaries && session.currentKeyword) {
      await this.updateKeywordSummary(sessionId, session.currentKeyword, {
        status: 'stopped',
        lastUpdate: timestamp,
      });
    }

    return this.sessions.get(sessionId);
  }

  async resumeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === 'completed') {
      throw new Error(`Session ${sessionId} sudah selesai dan tidak bisa di-resume`);
    }

    const timestamp = new Date().toISOString();
    const resumed = await this.updateSession(sessionId, {
      status: 'running',
      endTime: null,
      lastUpdate: timestamp,
    });

    if (resumed.keywordSummaries && resumed.currentKeyword) {
      await this.updateKeywordSummary(sessionId, resumed.currentKeyword, {
        status: 'running',
        lastUpdate: timestamp,
      });
    }

    return resumed;
  }

  async completeSession(sessionId) {
    const timestamp = new Date().toISOString();
    return await this.updateSession(sessionId, {
      status: 'completed',
      endTime: timestamp,
      currentKeyword: null,
      currentKeywordIndex: (this.sessions.get(sessionId)?.totalKeywords) || 0,
      currentIndex: 0,
      totalFound: 0,
    });
  }

  async saveSession(session) {
    try {
      const filePath = path.join(SESSIONS_DIR, `${session.sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
    } catch (error) {
      console.error(`Error saving session ${session.sessionId}:`, error);
    }
  }

  async loadSession(sessionId) {
    try {
      const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      const session = JSON.parse(data);
      this.sessions.set(sessionId, session);
      return session;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async loadAllSessions() {
    try {
      const files = await fs.readdir(SESSIONS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionId = path.basename(file, '.json');
          await this.loadSession(sessionId);
        }
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  }

  async deleteSession(sessionId) {
    try {
      this.sessions.delete(sessionId);
      const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
      await fs.unlink(filePath).catch(() => {});
      return true;
    } catch (error) {
      console.error(`Error deleting session ${sessionId}:`, error);
      return false;
    }
  }

  async updateKeywordSummary(sessionId, keyword, updates) {
    const session = this.sessions.get(sessionId);
    if (!session || !Array.isArray(session.keywordSummaries)) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const keywordSummaries = session.keywordSummaries.map(summary => {
      if (summary.keyword === keyword) {
        return {
          ...summary,
          ...updates,
          lastUpdate: timestamp,
        };
      }
      return summary;
    });

    return await this.updateSession(sessionId, { keywordSummaries });
  }

  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      keywords: session.keywords,
      totalKeywords: session.totalKeywords,
      currentKeywordIndex: session.currentKeywordIndex,
      currentKeyword: session.currentKeyword,
      location: session.location,
      status: session.status,
      startTime: session.startTime,
      lastUpdate: session.lastUpdate,
      endTime: session.endTime,
      currentIndex: session.currentIndex,
      totalFound: session.totalFound,
      maxResults: session.maxResults,
      resultsCount: session.results.length,
      errorsCount: session.errors.length,
      keywordSummaries: session.keywordSummaries,
    };
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      keywords: session.keywords,
      totalKeywords: session.totalKeywords,
      currentKeywordIndex: session.currentKeywordIndex,
      currentKeyword: session.currentKeyword,
      location: session.location,
      status: session.status,
      startTime: session.startTime,
      lastUpdate: session.lastUpdate,
      endTime: session.endTime,
      totalFound: session.totalFound,
      resultsCount: session.results.length,
      keywordSummaries: session.keywordSummaries,
    }));
  }
}

module.exports = new SessionService();


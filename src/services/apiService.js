const API_BASE_URL = 'http://localhost:5000/api';

export const scraperAPI = {
  // Scrape single keyword
  scrapeSingle: async (keyword, location = '') => {
    try {
      const response = await fetch(`${API_BASE_URL}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword, location, maxResults: 0 }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  // Scrape multiple keywords
  scrapeMultiple: async (keywords) => {
    try {
      const response = await fetch(`${API_BASE_URL}/scrape-multiple`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keywords }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  // Session APIs
  session: {
    // Start new session
    start: async (keywords, location = '', maxResults = 0) => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ keywords, location, maxResults }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error('Session Start Error:', error);
        throw error;
      }
    },

    // Get all sessions
    getAll: async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Get Sessions Error:', error);
        throw error;
      }
    },

    // Get session status
    getStatus: async (sessionId) => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session/${sessionId}/status`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Get Session Status Error:', error);
        throw error;
      }
    },

    // Get session results
    getResults: async (sessionId) => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session/${sessionId}/results`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Get Session Results Error:', error);
        throw error;
      }
    },

    // Download session results
    download: async (sessionId, format = 'json') => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session/${sessionId}/download?format=${format}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (format === 'csv') {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-${sessionId}-${Date.now()}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          return { success: true };
        } else {
          const data = await response.json();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-${sessionId}-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          return { success: true };
        }
      } catch (error) {
        console.error('Download Session Error:', error);
        throw error;
      }
    },

    // Stop session
    stop: async (sessionId) => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session/${sessionId}/stop`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Stop Session Error:', error);
        throw error;
      }
    },

    // Resume session
    resume: async (sessionId) => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session/${sessionId}/resume`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Resume Session Error:', error);
        throw error;
      }
    },

    // Delete session
    delete: async (sessionId) => {
      try {
        const response = await fetch(`${API_BASE_URL}/scrape-session/${sessionId}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error('Delete Session Error:', error);
        throw error;
      }
    },
  },
};
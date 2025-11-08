import React, { useState, useRef, useEffect } from 'react';
import { Search, Upload, Download, Loader2, AlertCircle, CheckCircle, Trash2, Globe, Play, Square, RefreshCw, FileText, Calendar, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { scraperAPI } from './services/apiService';

export default function GoogleMapsScraper() {
  // Scraping state with session support
  const [keywords, setKeywords] = useState([]);
  const [inputKeyword, setInputKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(0);
  const [results, setResults] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showAllResults, setShowAllResults] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentKeyword, setCurrentKeyword] = useState('');
  const [error, setError] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking');
  const fileInputRef = useRef(null);

  // Session state
  const [currentSession, setCurrentSession] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [previousSessions, setPreviousSessions] = useState([]);
  const sessionRefreshIntervalRef = useRef(null);
  const shouldStopRef = useRef(false);
  const sessionMonitorRef = useRef(null);
  const monitoringExistingRef = useRef(false);

  // Check backend status on mount
  useEffect(() => {
    checkBackendStatus();
    loadPreviousSessions();
  }, []);

  // Auto-refresh current session every 3 seconds if processing
  useEffect(() => {
    if (isProcessing && currentSession) {
      sessionRefreshIntervalRef.current = setInterval(() => {
        refreshCurrentSession();
      }, 3000);
    } else {
      if (sessionRefreshIntervalRef.current) {
        clearInterval(sessionRefreshIntervalRef.current);
        sessionRefreshIntervalRef.current = null;
      }
    }

    return () => {
      if (sessionRefreshIntervalRef.current) {
        clearInterval(sessionRefreshIntervalRef.current);
        sessionRefreshIntervalRef.current = null;
      }
    };
  }, [isProcessing, currentSession]);

  const checkBackendStatus = async () => {
    try {
      const response = await fetch('http://localhost:5000/health');
      if (response.ok) {
        setBackendStatus('online');
      } else {
        setBackendStatus('offline');
      }
    } catch (error) {
      setBackendStatus('offline');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const uploadedKeywords = data
          .slice(1)
          .map(row => row[0])
          .filter(keyword => keyword && keyword.toString().trim() !== '');
        
        setKeywords(prev => [...new Set([...prev, ...uploadedKeywords.map(k => k.toString().trim())])]);
        setError('');
      } catch (err) {
        setError('Gagal membaca file Excel. Pastikan format file benar.');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleAddKeyword = () => {
    const trimmed = inputKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords(prev => [...prev, trimmed]);
      setInputKeyword('');
      setError('');
    }
  };

  const handleRemoveKeyword = (keyword) => {
    setKeywords(prev => prev.filter(k => k !== keyword));
  };

  const handleScrape = async () => {
    if (keywords.length === 0) {
      setError('Silakan tambahkan keyword terlebih dahulu');
      return;
    }

    if (backendStatus !== 'online') {
      setError('Backend server tidak aktif. Jalankan backend terlebih dahulu!');
      return;
    }

    monitoringExistingRef.current = false;
    setIsProcessing(true);
    setError('');
    setResults([]);
    setProgress(0);
    setCurrentPage(1);
    shouldStopRef.current = false;

    try {
      const sessionResponse = await scraperAPI.session.start(
        keywords,
        location || '',
        maxResults || 0
      );

      if (!sessionResponse.success) {
        setError(sessionResponse.error || 'Gagal memulai session scraping.');
        setIsProcessing(false);
        shouldStopRef.current = false;
        return;
      }

      const sessionId = sessionResponse.sessionId;
      const sessionInfo = sessionResponse.session || null;

      setCurrentSession(sessionId);
      setSessionStatus(sessionInfo);
      setCurrentKeyword(sessionInfo?.currentKeyword || keywords[0] || '');

      await loadPreviousSessions();
      await startMonitoringExistingSession({
        sessionId,
        ...sessionInfo,
      });
    } catch (err) {
      console.error('Scraping error:', err);
      setError(err.message || 'Terjadi kesalahan saat memulai scraping.');
      setIsProcessing(false);
      shouldStopRef.current = false;
    }
  };

  const handleExportExcel = () => {
    if (results.length === 0) return;

    const exportData = results.map((result, index) => ({
      'No': index + 1,
      'Nama Bisnis': result.name,
      'Nomor Telepon': result.phone,
      'Alamat': result.address,
      'Rating': result.rating,
      'Kategori': result.category,
      'Keyword': result.keyword
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Hasil Scraping');
    
    worksheet['!cols'] = [
      { wch: 5 },
      { wch: 40 },
      { wch: 20 },
      { wch: 50 },
      { wch: 15 },
      { wch: 25 },
      { wch: 20 }
    ];

    XLSX.writeFile(workbook, `google_maps_scraping_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Session functions
  const loadPreviousSessions = async () => {
    try {
      const response = await scraperAPI.session.getAll();
      if (response.success) {
        // Filter hanya session yang belum selesai atau sudah selesai tapi masih relevan
        const relevantSessions = (response.sessions || []).filter(s => 
          s.status !== 'completed' || (s.status === 'completed' && s.resultsCount > 0)
        );
        setPreviousSessions(relevantSessions.slice(0, 10)); // Limit to 10 most recent
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const refreshCurrentSession = async (sessionIdParam) => {
    const sessionIdToUse = sessionIdParam || currentSession;
    if (!sessionIdToUse) return;
    
    try {
      const statusResponse = await scraperAPI.session.getStatus(sessionIdToUse);
      if (!statusResponse.success) {
        return;
      }

      const status = statusResponse.status;
      setSessionStatus(status);
      setCurrentKeyword(status?.currentKeyword || status?.keyword || '');

      const resultsResponse = await scraperAPI.session.getResults(sessionIdToUse);
      if (resultsResponse.success && Array.isArray(resultsResponse.data)) {
        const formattedData = resultsResponse.data.map(business => ({
          name: business.name,
          phone: business.phone || 'N/A',
          address: business.address || 'N/A',
          rating: business.rating || 'N/A',
          category: business.category || 'N/A',
          keyword: business.keyword || status.currentKeyword || '',
        }));
        setResults(formattedData);
        setCurrentPage(1);
      }

      let computedProgress = 0;
      if (status?.totalKeywords && status.totalKeywords > 0) {
        const keywordIndex = status.currentKeywordIndex || 0;
        const perKeywordProgress = status.totalFound > 0
          ? ((status.currentIndex || 0) / status.totalFound)
          : 0;
        computedProgress = ((keywordIndex + perKeywordProgress) / Math.max(status.totalKeywords, 1)) * 100;
      } else if (status?.totalFound > 0) {
        computedProgress = ((status.currentIndex || 0) / status.totalFound) * 100;
      }
      const safeProgress = Number.isFinite(computedProgress) ? computedProgress : 0;
      setProgress(Math.max(0, Math.min(safeProgress, 100)));

      if (status?.status === 'completed' || status?.status === 'stopped') {
        if (monitoringExistingRef.current) {
          monitoringExistingRef.current = false;
        }
        setIsProcessing(false);
        setCurrentSession(null);
        setCurrentKeyword('');
        await loadPreviousSessions();
      }
    } catch (error) {
      console.error('Error refreshing session:', error);
    }
  };

  const handleStopScraping = async () => {
    if (!currentSession) return;
    
    try {
      // Set flag to stop
      shouldStopRef.current = true;
      
      // Stop session on server
      await scraperAPI.session.stop(currentSession);
      
      // Refresh to get latest status
      await refreshCurrentSession();
      await loadPreviousSessions();
      
      setError('Scraping dihentikan. Anda dapat melanjutkan nanti dengan tombol Resume di Previous Sessions.');
    } catch (error) {
      setError(error.message || 'Gagal menghentikan scraping');
    }
  };

  const startMonitoringExistingSession = async (sessionInfo) => {
    if (!sessionInfo || !sessionInfo.sessionId) return;
    if (monitoringExistingRef.current && currentSession === sessionInfo.sessionId) return;

    monitoringExistingRef.current = true;
    shouldStopRef.current = false;
    setIsProcessing(true);
    setCurrentSession(sessionInfo.sessionId);
    setCurrentKeyword(sessionInfo.currentKeyword || sessionInfo.keyword || '');
    setSessionStatus(sessionInfo);

    await refreshCurrentSession(sessionInfo.sessionId);
  };

  const handleResumeSession = async (sessionId) => {
    if (backendStatus !== 'online') {
      setError('Backend server tidak aktif');
      return;
    }

    if (isProcessing) {
      setError('Tunggu scraping saat ini selesai terlebih dahulu');
      return;
    }

    try {
      setError('');
      shouldStopRef.current = false;

      await scraperAPI.session.resume(sessionId);

      const statusResponse = await scraperAPI.session.getStatus(sessionId);
      if (statusResponse.success) {
        await startMonitoringExistingSession({
          sessionId,
          ...statusResponse.status,
        });
      } else {
        setIsProcessing(false);
      }
    } catch (error) {
      setError(error.message || 'Gagal melanjutkan session');
      setIsProcessing(false);
      shouldStopRef.current = false;
    } finally {
      await loadPreviousSessions();
    }
  };

  const handleDownloadCurrentSession = async (format = 'json') => {
    if (!currentSession) return;
    
    try {
      await scraperAPI.session.download(currentSession, format);
    } catch (error) {
      setError(error.message || 'Gagal mengunduh hasil');
    }
  };

  const handleDownloadSession = async (sessionId, format = 'json') => {
    try {
      await scraperAPI.session.download(sessionId, format);
    } catch (error) {
      setError(error.message || 'Gagal mengunduh hasil');
    }
  };

  const handleViewSessionResults = async (sessionId) => {
    try {
      const resultsResponse = await scraperAPI.session.getResults(sessionId);
      if (resultsResponse.success && resultsResponse.data) {
        const formattedData = resultsResponse.data.map(business => ({
          name: business.name,
          phone: business.phone || 'N/A',
          address: business.address || 'N/A',
          rating: business.rating || 'N/A',
          category: business.category || 'N/A',
          keyword: business.keyword || ''
        }));
        setResults(formattedData);
        setCurrentPage(1);
        
        // Scroll to results section
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    } catch (error) {
      setError(error.message || 'Gagal memuat hasil session');
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [results.length]);

  useEffect(() => {
    if (!showAllResults) {
      const pageCount = Math.max(1, Math.ceil((results.length || 0) / pageSize));
      setCurrentPage(prev => Math.min(prev, pageCount));
    }
  }, [results.length, pageSize, showAllResults]);

  const totalResults = results.length;
  const totalPages = showAllResults ? 1 : Math.max(1, Math.ceil((totalResults || 0) / pageSize));
  const safeCurrentPage = showAllResults ? 1 : Math.min(currentPage, totalPages);
  const startIndex = totalResults === 0 ? 0 : showAllResults ? 0 : (safeCurrentPage - 1) * pageSize;
  const endIndex = showAllResults ? totalResults : Math.min(totalResults, startIndex + pageSize);
  const paginatedResults = showAllResults ? results : results.slice(startIndex, endIndex);

  const activeKeywordLabel = sessionStatus?.currentKeyword || sessionStatus?.keyword || currentKeyword || '';
  const keywordStepText = sessionStatus?.totalKeywords
    ? `${Math.min((sessionStatus.currentKeywordIndex || 0) + 1, sessionStatus.totalKeywords)} / ${sessionStatus.totalKeywords}`
    : null;

  const handlePageSizeChange = (event) => {
    const value = parseInt(event.target.value, 10);
    setPageSize(value);
    setShowAllResults(false);
    setCurrentPage(1);
  };

  const handleToggleShowAll = () => {
    setShowAllResults(prev => !prev);
    setCurrentPage(1);
  };

  const goToPreviousPage = () => {
    if (safeCurrentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  };

  const goToNextPage = () => {
    if (safeCurrentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  };

  useEffect(() => {
    if (isProcessing) return;
    const runningSession = previousSessions.find(session => session.status === 'running');
    if (runningSession) {
      startMonitoringExistingSession(runningSession);
    }
  }, [previousSessions, isProcessing]);

  const handleDeleteSession = async (sessionId) => {
    if (!confirm('Yakin ingin menghapus session ini?')) return;

    try {
      await scraperAPI.session.delete(sessionId);
      await loadPreviousSessions();
    } catch (error) {
      setError(error.message || 'Gagal menghapus session');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'running':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'stopped':
        return 'bg-red-500';
      case 'paused':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'running':
        return 'Berjalan';
      case 'completed':
        return 'Selesai';
      case 'stopped':
        return 'Dihentikan';
      case 'paused':
        return 'Ditunda';
      default:
        return status;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('id-ID');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-600 rounded-xl">
                <Search className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Google Maps Scraper</h1>
                <p className="text-gray-600 text-sm">
                  Real-time scraping dengan Puppeteer
                </p>
              </div>
            </div>
            
            {/* Backend Status */}
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-gray-600" />
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  backendStatus === 'online' ? 'bg-green-500 animate-pulse' :
                  backendStatus === 'offline' ? 'bg-red-500' :
                  'bg-yellow-500'
                }`} />
                <span className="text-sm font-medium text-gray-700">
                  Backend {backendStatus === 'online' ? 'Online' : backendStatus === 'offline' ? 'Offline' : 'Checking...'}
                </span>
              </div>
            </div>
          </div>
        </div>


        {/* Backend Offline Warning */}
        {backendStatus === 'offline' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-800 mb-1">Backend Server Offline</h3>
                <p className="text-sm text-red-700 mb-2">
                  Backend server tidak berjalan. Jalankan backend dengan perintah:
                </p>
                <code className="block bg-red-100 text-red-800 px-3 py-2 rounded text-sm font-mono">
                  cd backend && npm start
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Input Section */}
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Input Keywords</h2>
          
          {/* Manual Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tambah Keyword Manual
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputKeyword}
                onChange={(e) => setInputKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddKeyword()}
                placeholder="Contoh: restoran padang semarang, salon kecantikan"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                disabled={isProcessing}
              />
              <button
                onClick={handleAddKeyword}
                disabled={isProcessing}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tambah
              </button>
            </div>
          </div>

          {/* Location and Max Results */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location (Optional)
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Contoh: Palembang, Jakarta"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                disabled={isProcessing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Results (0 = unlimited)
              </label>
              <input
                type="number"
                value={maxResults}
                onChange={(e) => setMaxResults(parseInt(e.target.value) || 0)}
                min="0"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                disabled={isProcessing}
              />
            </div>
          </div>

          {/* File Upload */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload File Excel
            </label>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                <Upload className="w-5 h-5" />
                Upload Excel
              </button>
              <div className="flex-1 flex items-center px-4 py-3 bg-gray-50 rounded-lg text-gray-500 text-sm">
                Format: Kolom pertama berisi keywords (skip header)
              </div>
            </div>
          </div>

          {/* Keywords List */}
          {keywords.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Keywords yang Akan Diproses ({keywords.length})
              </label>
              <div className="bg-gray-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {keywords.map((keyword, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-gray-200"
                    >
                      <span className="text-sm text-gray-700">{keyword}</span>
                      <button
                        onClick={() => handleRemoveKeyword(keyword)}
                        className="text-red-500 hover:text-red-700"
                        disabled={isProcessing}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Current Processing with Session Info */}
          {isProcessing && (
            <div className="mb-4 space-y-3">
              {currentKeyword && (
                <div className="flex items-center gap-2 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
                  <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  <span className="text-sm">Sedang scraping: <strong>{currentKeyword}</strong></span>
                </div>
              )}
              
              {currentSession && sessionStatus && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm font-semibold text-green-800">
                        Session Aktif: {activeKeywordLabel || 'Memuat...'}
                      </span>
                    </div>
                    <span className="text-xs text-green-600">
                      {keywordStepText ? `Keyword ${keywordStepText}` : ''}
                    </span>
                  </div>
                  <div className="w-full bg-green-200 rounded-full h-2 mb-3">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-green-600 mb-3">
                    Proses bisnis: {sessionStatus.currentIndex || 0} / {sessionStatus.totalFound || 0}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleStopScraping}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                    >
                      <Square className="w-4 h-4" />
                      Stop
                    </button>
                    <button
                      onClick={() => handleDownloadCurrentSession('json')}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download JSON
                    </button>
                    <button
                      onClick={() => handleDownloadCurrentSession('csv')}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                    >
                      <FileText className="w-4 h-4" />
                      Download CSV
                    </button>
                  </div>
                  {currentSession && (
                    <div className="mt-2 text-xs text-green-600">
                      Session ID: {currentSession.substring(0, 8)}... (Bisa di-resume nanti)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Scrape Button */}
          <button
            onClick={handleScrape}
            disabled={isProcessing || keywords.length === 0 || backendStatus !== 'online'}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Memproses... {Math.round(progress)}%
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Mulai Scraping dengan Session
              </>
            )}
          </button>
        </div>

        {/* Previous Sessions */}
        {previousSessions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Previous Sessions</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Session sebelumnya yang bisa di-resume atau di-download
                </p>
              </div>
              <button
                onClick={loadPreviousSessions}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
            <div className="space-y-3">
              {previousSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-3 h-3 rounded-full ${
                          session.status === 'running' ? 'bg-blue-500 animate-pulse' :
                          session.status === 'completed' ? 'bg-green-500' :
                          session.status === 'stopped' ? 'bg-red-500' :
                          'bg-gray-500'
                        }`} />
                        <span className="font-semibold text-gray-800">
                          {session.currentKeyword || (Array.isArray(session.keywords) && session.keywords.length > 0
                            ? session.keywords.slice(0, 3).join(', ') + (session.keywords.length > 3 ? '…' : '')
                            : 'Session')}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          session.status === 'running' ? 'bg-blue-100 text-blue-700' :
                          session.status === 'completed' ? 'bg-green-100 text-green-700' :
                          session.status === 'stopped' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {session.status === 'running' ? 'Berjalan' :
                           session.status === 'completed' ? 'Selesai' :
                           session.status === 'stopped' ? 'Dihentikan' :
                           session.status}
                        </span>
                      </div>
                      {Array.isArray(session.keywords) && session.keywords.length > 0 && (
                        <p className="text-sm text-gray-600 mb-1">
                          🔍 {session.keywords.slice(0, 3).join(', ')}
                          {session.keywords.length > 3 ? ` +${session.keywords.length - 3} keyword lainnya` : ''}
                        </p>
                      )}
                      {session.location && (
                        <p className="text-sm text-gray-600 mb-1">📍 {session.location}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <FileText className="w-4 h-4" />
                          {session.resultsCount || 0} results
                        </span>
                        <span className="flex items-center gap-1">
                          <Search className="w-4 h-4" />
                          {(session.totalKeywords || (session.keywords?.length ?? 0))} keywords
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {formatDate(session.startTime)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {session.status === 'running' && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await scraperAPI.session.stop(session.sessionId);
                              await loadPreviousSessions();
                            } catch (error) {
                              setError(error.message || 'Gagal menghentikan session');
                            }
                          }}
                          className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                          title="Stop Session"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      )}
                      {(session.status === 'stopped' || session.status === 'paused') && (
                        <button
                          onClick={() => handleResumeSession(session.sessionId)}
                          className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                          title="Resume Session"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      {session.status === 'completed' && session.resultsCount > 0 && (
                        <button
                          onClick={() => handleViewSessionResults(session.sessionId)}
                          className="p-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                          title="Lihat Hasil"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDownloadSession(session.sessionId, 'json')}
                        className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                        title="Download JSON"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownloadSession(session.sessionId, 'csv')}
                        className="p-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                        title="Download CSV"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSession(session.sessionId)}
                        className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                        title="Delete Session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results Section */}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h2 className="text-xl font-semibold text-gray-800">
                  Hasil Scraping ({totalResults} bisnis)
                </h2>
              </div>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                <Download className="w-5 h-5" />
                Export Excel
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div className="text-sm text-gray-600">
                {showAllResults
                  ? `Menampilkan seluruh ${totalResults} bisnis`
                  : `Menampilkan ${totalResults === 0 ? 0 : startIndex + 1} - ${endIndex} dari ${totalResults} bisnis`}
              </div>
              <div className="flex items-center gap-3">
                {!showAllResults && (
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    Per halaman
                    <select
                      value={pageSize}
                      onChange={handlePageSizeChange}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {[10, 25, 50, 100].map(size => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  onClick={handleToggleShowAll}
                  className="px-3 py-2 text-sm border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  {showAllResults ? 'Mode Paginasi' : 'Tampilkan Semua'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">No</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Nama Bisnis</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Rating</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Kategori</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Alamat</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Telepon</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Keyword</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((result, idx) => (
                    <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">{startIndex + idx + 1}</td>
                      <td className="px-4 py-3 text-sm text-gray-800 font-medium">{result.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{result.rating}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{result.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{result.address}</td>
                      <td className="px-4 py-3 text-sm text-gray-800">{result.phone}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                          {result.keyword}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!showAllResults && totalPages > 1 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-4">
                <button
                  onClick={goToPreviousPage}
                  disabled={safeCurrentPage === 1}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
                    safeCurrentPage === 1
                      ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Sebelumnya
                </button>

                <div className="text-sm text-gray-600">
                  Halaman {safeCurrentPage} dari {totalPages}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={safeCurrentPage === totalPages}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
                    safeCurrentPage === totalPages
                      ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Selanjutnya
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Info Footer */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <strong>Session Support:</strong> Setiap scraping otomatis menggunakan session system. 
              Anda bisa stop/resume scraping kapan saja, download hasil sementara, dan melanjutkan besok. 
              Session data tersimpan di server dan dapat di-resume setelah server restart.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
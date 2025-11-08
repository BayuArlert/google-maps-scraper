# Session Scraping API Documentation

API untuk melakukan scraping dengan session management, memungkinkan stop/resume dan download hasil sementara.

## Endpoints

### 1. Start Session
Memulai scraping session baru.

**POST** `/api/scrape-session`

**Request Body:**
```json
{
  "keyword": "Resto Area Palembang",
  "location": "Palembang",
  "maxResults": 0,
  "options": {}
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-string",
  "message": "Session started",
  "session": {
    "sessionId": "uuid-string",
    "keyword": "Resto Area Palembang",
    "location": "Palembang",
    "status": "running",
    "startTime": "2024-01-01T00:00:00.000Z",
    "currentIndex": 0,
    "totalFound": 0,
    "resultsCount": 0
  }
}
```

### 2. Get Session Status
Mendapatkan status session.

**GET** `/api/scrape-session/:sessionId/status`

**Response:**
```json
{
  "success": true,
  "status": {
    "sessionId": "uuid-string",
    "keyword": "Resto Area Palembang",
    "location": "Palembang",
    "status": "running",
    "startTime": "2024-01-01T00:00:00.000Z",
    "lastUpdate": "2024-01-01T00:05:00.000Z",
    "currentIndex": 25,
    "totalFound": 50,
    "resultsCount": 25,
    "maxResults": 0,
    "errorsCount": 0
  }
}
```

### 3. Get Session Results
Mendapatkan hasil scraping session (real-time).

**GET** `/api/scrape-session/:sessionId/results`

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-string",
  "keyword": "Resto Area Palembang",
  "location": "Palembang",
  "status": "running",
  "count": 25,
  "data": [
    {
      "name": "Restaurant Name",
      "rating": 4.5,
      "address": "Jl. Example",
      "phone": "081234567890"
    }
  ]
}
```

### 4. Download Session Results
Download hasil scraping dalam format JSON atau CSV.

**GET** `/api/scrape-session/:sessionId/download?format=json`

**Query Parameters:**
- `format`: `json` (default) atau `csv`

**Response:**
- JSON: File JSON dengan hasil scraping
- CSV: File CSV dengan hasil scraping

### 5. Stop Session
Menghentikan session yang sedang berjalan.

**POST** `/api/scrape-session/:sessionId/stop`

**Response:**
```json
{
  "success": true,
  "message": "Session stopped",
  "session": {
    "sessionId": "uuid-string",
    "status": "stopped",
    ...
  }
}
```

### 6. Resume Session
Melanjutkan session yang dihentikan.

**POST** `/api/scrape-session/:sessionId/resume`

**Response:**
```json
{
  "success": true,
  "message": "Session resumed",
  "session": {
    "sessionId": "uuid-string",
    "status": "running",
    ...
  },
  "startFromIndex": 25
}
```

### 7. Get All Sessions
Mendapatkan daftar semua session.

**GET** `/api/scrape-session`

**Response:**
```json
{
  "success": true,
  "count": 2,
  "sessions": [
    {
      "sessionId": "uuid-1",
      "keyword": "Resto Area Palembang",
      "location": "Palembang",
      "status": "running",
      "startTime": "2024-01-01T00:00:00.000Z",
      "totalFound": 50,
      "resultsCount": 25
    },
    {
      "sessionId": "uuid-2",
      "keyword": "Cafe Jakarta",
      "location": "Jakarta",
      "status": "completed",
      "startTime": "2024-01-01T01:00:00.000Z",
      "totalFound": 30,
      "resultsCount": 30
    }
  ]
}
```

### 8. Delete Session
Menghapus session.

**DELETE** `/api/scrape-session/:sessionId`

**Response:**
```json
{
  "success": true,
  "message": "Session deleted"
}
```

## Session Status

- `running`: Session sedang berjalan
- `paused`: Session di-pause (tidak digunakan saat ini)
- `stopped`: Session dihentikan oleh user
- `completed`: Session selesai

## Workflow

1. **Start Session**: 
   ```bash
   POST /api/scrape-session
   {
     "keyword": "Resto Area Palembang",
     "location": "Palembang"
   }
   ```

2. **Check Status** (optional):
   ```bash
   GET /api/scrape-session/:sessionId/status
   ```

3. **Download Results Anytime**:
   ```bash
   GET /api/scrape-session/:sessionId/download?format=json
   ```

4. **Stop Session** (jika perlu):
   ```bash
   POST /api/scrape-session/:sessionId/stop
   ```

5. **Resume Session** (jika sudah di-stop):
   ```bash
   POST /api/scrape-session/:sessionId/resume
   ```

## Contoh Penggunaan

### Menggunakan cURL

```bash
# Start session
curl -X POST http://localhost:3000/api/scrape-session \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "Resto Area Palembang",
    "location": "Palembang"
  }'

# Check status
curl http://localhost:3000/api/scrape-session/SESSION_ID/status

# Download results (JSON)
curl http://localhost:3000/api/scrape-session/SESSION_ID/download?format=json -o results.json

# Download results (CSV)
curl http://localhost:3000/api/scrape-session/SESSION_ID/download?format=csv -o results.csv

# Stop session
curl -X POST http://localhost:3000/api/scrape-session/SESSION_ID/stop

# Resume session
curl -X POST http://localhost:3000/api/scrape-session/SESSION_ID/resume
```

### Menggunakan JavaScript (Fetch API)

```javascript
// Start session
const startSession = async () => {
  const response = await fetch('http://localhost:3000/api/scrape-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      keyword: 'Resto Area Palembang',
      location: 'Palembang'
    })
  });
  
  const data = await response.json();
  return data.sessionId;
};

// Get status
const getStatus = async (sessionId) => {
  const response = await fetch(`http://localhost:3000/api/scrape-session/${sessionId}/status`);
  return await response.json();
};

// Download results
const downloadResults = async (sessionId, format = 'json') => {
  const response = await fetch(`http://localhost:3000/api/scrape-session/${sessionId}/download?format=${format}`);
  
  if (format === 'csv') {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId}.csv`;
    a.click();
  } else {
    const data = await response.json();
    console.log(data);
  }
};

// Stop session
const stopSession = async (sessionId) => {
  const response = await fetch(`http://localhost:3000/api/scrape-session/${sessionId}/stop`, {
    method: 'POST'
  });
  return await response.json();
};

// Resume session
const resumeSession = async (sessionId) => {
  const response = await fetch(`http://localhost:3000/api/scrape-session/${sessionId}/resume`, {
    method: 'POST'
  });
  return await response.json();
};
```

## Catatan

- Session data disimpan di folder `backend/sessions/`
- Setiap session memiliki file JSON terpisah
- Session dapat di-resume dari index terakhir sebelum di-stop
- Hasil scraping otomatis tersimpan setiap kali ada update
- Download bisa dilakukan kapan saja, bahkan saat session masih berjalan


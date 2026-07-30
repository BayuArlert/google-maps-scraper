const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sessionService = require('./sessionService');
const fs = require('fs');
const path = require('path');
const os = require('os');

puppeteer.use(StealthPlugin());

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Function to find Chrome executable (fallback if not set via env)
function findChromeExecutable() {
  const platform = process.platform;
  
  if (platform === 'win32') {
    const possiblePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
    ];
    
    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    }
  } else if (platform === 'darwin') {
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome',
    ];
    
    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    }
  } else if (platform === 'linux') {
    const possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    
    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    }
  }
  
  return null;
}

class ScraperService {
  constructor() {
    this.activeBrowsers = new Map(); // Store browser instances for stopping
  }

  resolveHeadlessMode(options = {}) {
    if (options && typeof options.headless !== 'undefined') {
      return options.headless;
    }

    const envValue = process.env.HEADLESS;
    if (typeof envValue === 'string') {
      const normalized = envValue.trim().toLowerCase();
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
      if (['new'].includes(normalized)) {
        return 'new';
      }
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
    }

    return true; // Default: headless
  }

  buildLaunchOptions(options = {}) {
    const headless = this.resolveHeadlessMode(options);

    const defaultArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1920x1080'
    ];

    const args = Array.isArray(options.args)
      ? Array.from(new Set([...defaultArgs, ...options.args]))
      : defaultArgs;

    const launchOptions = {
      headless,
      args,
      defaultViewport: null
    };

    // Try to get Chrome executable path from multiple sources
    // Priority: options > environment variable > auto-detect
    let executablePath =
      options.executablePath ||
      process.env.CHROME_EXECUTABLE_PATH ||
      process.env.PUPPETEER_EXECUTABLE_PATH;

    // Fallback: auto-detect Chrome if not set
    if (!executablePath) {
      executablePath = findChromeExecutable();
      if (executablePath) {
        console.log(`✅ Auto-detected Chrome at: ${executablePath}`);
      } else {
        console.log(`⚠️ Chrome not found. Puppeteer will try to use bundled Chromium.`);
        console.log(`   If scraping fails, please install Google Chrome or set CHROME_EXECUTABLE_PATH environment variable.`);
      }
    }

    if (executablePath) {
      launchOptions.executablePath = executablePath;
      console.log(`🚀 Using Chrome/Chromium executable: ${executablePath}`);
    }

    if (options.ignoreDefaultArgs) {
      launchOptions.ignoreDefaultArgs = options.ignoreDefaultArgs;
    }

    if (options.userDataDir) {
      launchOptions.userDataDir = options.userDataDir;
    }

    if (options.defaultViewport) {
      launchOptions.defaultViewport = options.defaultViewport;
    }

    return launchOptions;
  }
  async scrapeGoogleMaps(keyword, location = '', maxResults = 0, options = {}) {
    let browser;
    
    try {
      console.log(`🔍 Scraping keyword: ${keyword}`);
      
      // Launch browser dengan stealth mode (headless configurable)
      const launchOptions = this.buildLaunchOptions(options);
      browser = await puppeteer.launch(launchOptions);

      const page = await browser.newPage();
      
      // Set user agent untuk bypass detection
      await page.setUserAgent(DEFAULT_USER_AGENT);

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Build search query
      const searchQuery = location 
        ? `${keyword} ${location}`
        : keyword;

      const encodedQuery = encodeURIComponent(searchQuery);
      const url = `https://www.google.com/maps/search/${encodedQuery}`;

      console.log(`📍 Opening: ${url}`);
      
      // Navigate ke Google Maps
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 60000 
      });

      // Wait for results to load
      await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
      
      // Tunggu sebentar untuk load data
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Scroll untuk load lebih banyak results
      await this.scrollResults(page, maxResults);

      // Extract data
      const businesses = await page.evaluate((maxResults) => {
        const results = [];
        
        // Coba beberapa selector yang berbeda untuk memastikan menangkap semua hasil
        const selectors = [
          'div[role="feed"] > div > div[jsaction]',
          'div[role="feed"] > div[jsaction]',
          'div[role="feed"] div[jsaction].m6QErb'
        ];
        
        let items = [];
        for (const selector of selectors) {
          const found = document.querySelectorAll(selector);
          if (found.length > items.length) {
            items = Array.from(found);
          }
        }
        
        // Jika tidak ada hasil dengan selector di atas, coba selector umum
        if (items.length === 0) {
          const feed = document.querySelector('div[role="feed"]');
          if (feed) {
            items = Array.from(feed.querySelectorAll('div[jsaction]'));
          }
        }

        // Deduplicate berdasarkan nama
        const seenNames = new Set();

        items.forEach((item) => {
          // Tidak ada limit, ambil semua hasil

          try {
            // Nama bisnis
            const nameElement = item.querySelector('div.fontHeadlineSmall') || 
                              item.querySelector('[class*="fontHeadline"]') ||
                              item.querySelector('div[aria-label]');
            const name = nameElement ? (nameElement.innerText || nameElement.getAttribute('aria-label') || '').trim() : '';

            // Skip jika tidak ada nama atau sudah pernah dilihat
            if (!name || seenNames.has(name)) return;
            seenNames.add(name);

            // Rating dan reviews - cari di berbagai tempat
            let rating = '';
            
            // Method 1: Cari dari aria-label
            const ratingElement = item.querySelector('span[role="img"]');
            if (ratingElement) {
              const ariaLabel = ratingElement.getAttribute('aria-label') || '';
              const ratingMatch = ariaLabel.match(/(\d+[.,]?\d*)/);
              if (ratingMatch) {
                rating = ratingMatch[1].replace(',', '.');
              }
            }
            
            // Method 2: Cari format rating seperti "4,6(67)" atau "4.6(67)" di teks
            if (!rating) {
              const allText = item.innerText || item.textContent || '';
              // Pattern untuk rating: angka, koma/titik, angka, kurung buka, angka, kurung tutup
              const ratingPatterns = [
                /(\d+[,.]\d+)\s*\((\d+)\)/,  // Format: 4,6(67) atau 4.6(67)
                /(\d+[,.]\d+)\s+stars?/i,     // Format: 4.6 stars
                /rating[:\s]+(\d+[,.]\d*)/i,  // Format: rating: 4.6
                /(\d+[,.]\d*)\s*\/\s*5/i     // Format: 4.6/5
              ];
              
              for (const pattern of ratingPatterns) {
                const match = allText.match(pattern);
                if (match && match[1]) {
                  rating = match[1].replace(',', '.');
                  break;
                }
              }
            }
            
            // Method 3: Cari di elemen yang mengandung rating
            if (!rating) {
              const ratingSelectors = [
                'span[aria-label*="star"]',
                'span[aria-label*="Star"]',
                'span[aria-label*="rating"]',
                'span[aria-label*="Rating"]',
                'div[class*="fontBodyMedium"] span'
              ];
              
              for (const selector of ratingSelectors) {
                const elements = item.querySelectorAll(selector);
                for (const el of elements) {
                  const text = el.innerText || el.getAttribute('aria-label') || '';
                  // Cek format rating
                  const ratingMatch = text.match(/(\d+[,.]\d+)\s*\((\d+)\)/);
                  if (ratingMatch && ratingMatch[1]) {
                    rating = ratingMatch[1].replace(',', '.');
                    break;
                  }
                }
                if (rating) break;
              }
            }

            // Kategori - cari dari berbagai sumber
            let category = '';
            
            // Prioritas 1: Cari button dengan jsaction yang mengandung "category" di dalam div.fontBodyMedium
            const categoryButton = item.querySelector('div.fontBodyMedium button[jsaction*="category"]') ||
                                  item.querySelector('div[class*="fontBodyMedium"] button[jsaction*="category"]') ||
                                  item.querySelector('button.DkEaL[jsaction*="category"]') ||
                                  item.querySelector('button[class*="DkEaL"][jsaction*="category"]') ||
                                  item.querySelector('button[jsaction*="category"]');
            
            if (categoryButton) {
              category = categoryButton.innerText.trim();
            }
            
            // Prioritas 2: Cari teks yang mengandung kata kategori umum (Produsen, Pabrik, dll)
            if (!category) {
              const allText = item.innerText || item.textContent || '';
              
              // Pattern untuk kategori umum
              const categoryKeywords = [
                /(Produsen|Pabrik|Factory|Manufacturer|Manufacturing)/i,
                /(Pabrik\s+[A-Za-z]+)/i,  // Pabrik Kapas, Pabrik tekstil, dll
                /(Kantor\s+Perusahaan|Office|Corporate)/i,
                /(Distributor|Supplier|Vendor)/i,
                /(Toko|Store|Shop|Retail)/i,
                /(Restoran|Restaurant|Cafe|Café)/i,
                /(Hotel|Penginapan|Lodging)/i,
                /(Bengkel|Workshop|Service)/i,
                /(Salon|Beauty|Kecantikan)/i,
                /(Klinik|Clinic|Puskesmas)/i,
                /(Sekolah|School|Education)/i
              ];
              
              for (const pattern of categoryKeywords) {
                const match = allText.match(pattern);
                if (match && match[1]) {
                  // Pastikan bukan bagian dari alamat atau nama
                  const matchText = match[1].trim();
                  const matchIndex = allText.indexOf(matchText);
                  
                  // Cek apakah ini bukan bagian dari nama bisnis (biasanya di awal)
                  const nameIndex = allText.indexOf(name);
                  if (matchIndex > nameIndex + name.length + 10) { // Setidaknya 10 karakter setelah nama
                    category = matchText;
                    break;
                  }
                }
              }
            }
            
            // Prioritas 3: Cari di struktur HTML spesifik - hanya button kategori, bukan teks lain
            if (!category) {
              // Cari semua button di dalam div.fontBodyMedium
              const allButtons = item.querySelectorAll('div.fontBodyMedium button, div[class*="fontBodyMedium"] button');
              for (const btn of allButtons) {
                const btnText = btn.innerText.trim();
                if (!btnText) continue;
                
                // Skip jika ini review count atau rating
                const isReviewCount = /^\(\d+\)$/.test(btnText);
                const isOnlyNumber = /^\d+[,.]?\d*$/.test(btnText);
                const isRating = /★|stars?|rating|review/i.test(btnText) ||
                                /^\d+[,.]\d+\s*\(\d+\)/.test(btnText) ||
                                /^\d+[,.]\d+\s*stars?/i.test(btnText) ||
                                isOnlyNumber ||
                                isReviewCount;
                
                if (!isRating && btnText.length > 0 && btnText.length < 100) {
                  category = btnText;
                  break;
                }
              }
            }
            
            // Prioritas 4: Fallback - cari di struktur HTML spesifik (jika button tidak ditemukan)
            if (!category) {
              const categorySelectors = [
                'div.fontBodyMedium > div > div:nth-child(1) span',
                'div.fontBodyMedium > div > div:first-child span',
                'div[class*="fontBodyMedium"] > div > div:first-child span'
              ];
              
              for (const selector of categorySelectors) {
                const elements = item.querySelectorAll(selector);
                for (const el of elements) {
                  const text = el.innerText.trim();
                  if (!text) continue;
                  
                  // Skip jika ini hanya angka atau rating (lebih ketat)
                  const isOnlyNumber = /^\d+[,.]?\d*$/.test(text); // Hanya angka seperti "4,6"
                  const isReviewCount = /^\(\d+\)$/.test(text); // Format: (5), (59), (170) - review count
                  const isRating = /★|stars?|rating|review/i.test(text) ||
                                  /^\d+[,.]\d+\s*\(\d+\)/.test(text) || // Format: 4,6(67)
                                  /^\d+[,.]\d+\s*stars?/i.test(text) || // Format: 4.6 stars
                                  /^\d+[,.]\d+\s*\/\s*5/.test(text) || // Format: 4.6/5
                                  isOnlyNumber || // Hanya angka saja
                                  isReviewCount; // Review count dalam kurung
                  
                  // Skip jika ini jam buka
                  const isHours = /^(buka|tutup|closed|open|24\s*jam|jam|hours)/i.test(text) ||
                                  /\d{1,2}:\d{2}/.test(text) ||
                                  /^\d{1,2}\s*(am|pm|AM|PM)/i.test(text) ||
                                  text.toLowerCase().includes('buka') ||
                                  text.toLowerCase().includes('tutup') ||
                                  text.toLowerCase().includes('closed') ||
                                  text.toLowerCase().includes('open');
                  
                  // Skip jika ini jarak
                  const isDistance = /^\d+\.?\d*\s*(km|m|meter|kilometer)/i.test(text);
                  
                  // Skip jika ini alamat
                  const isAddress = text.length > 50 || 
                                   /jalan|street|jl\.|jln|alamat|address/i.test(text);
                  
                  // Skip jika ini nama bisnis
                  const isName = text === name || text.includes(name);
                  
                if (!isHours && !isRating && !isDistance && !isAddress && !isName && 
                    text.length > 0 && text.length < 100 && 
                    !/^\d+[,.]?\d*$/.test(text) && // Pastikan bukan hanya angka
                    !/^\(\d+\)$/.test(text)) { // Pastikan bukan review count seperti (5), (59)
                  category = text;
                  break;
                }
                }
                if (category) break;
              }
            }

            // Alamat
            const addressElements = item.querySelectorAll('div.fontBodyMedium > div > div');
            let address = '';
            addressElements.forEach(el => {
              const text = el.innerText.trim();
              if (text && !text.includes('★') && !text.match(/^\d+\s*(km|m)$/) && text !== category) {
                address = text;
              }
            });

            // Jika alamat masih kosong, coba cari dengan selector lain
            if (!address) {
              const addressText = item.querySelector('[class*="fontBodyMedium"]');
              if (addressText) {
                const text = addressText.innerText.trim();
                if (text && !text.includes('★') && text !== category && text !== name) {
                  address = text;
                }
              }
            }

            // Coba ambil nomor telepon dari list view (jarang muncul tapi kadang ada)
            let phone = '';
            const linkElement = item.querySelector('a.hfpxzc');
            let detailUrl = linkElement ? linkElement.href : '';
            if (detailUrl && detailUrl.startsWith('/')) {
              detailUrl = `https://www.google.com${detailUrl}`;
            }
            
            // Method 1: Cari di div dengan class Io6YTe (selector spesifik Google Maps)
            const phoneDivs = item.querySelectorAll('div.Io6YTe, div[class*="Io6YTe"]');
            for (const div of phoneDivs) {
              const text = div.innerText || div.textContent || '';
              if (text) {
                const cleaned = text.replace(/\s+/g, '').replace(/[^\d+()-]/g, '').trim();
                if (cleaned.length >= 8 && cleaned.length <= 20 && /^[\d+()-]+$/.test(cleaned)) {
                  phone = cleaned;
                  break;
                }
              }
            }
            
            // Method 2: Coba selector lainnya jika belum ketemu
            if (!phone) {
              const phoneSelectors = [
                'button[data-item-id*="phone"]',
                'button[data-value*="phone"]',
                'a[href^="tel:"]',
                'span[aria-label*="phone"]',
                'div[aria-label*="phone"]'
              ];
              
              for (const selector of phoneSelectors) {
                const phoneElement = item.querySelector(selector);
                if (phoneElement) {
                  // Coba ambil dari berbagai atribut
                  phone = phoneElement.getAttribute('data-item-id') || 
                         phoneElement.getAttribute('data-value') ||
                         phoneElement.getAttribute('href') ||
                         phoneElement.getAttribute('aria-label') ||
                         phoneElement.innerText || '';
                  
                  // Clean up phone number
                  if (phone) {
                    phone = phone.replace(/phone:tel:/gi, '')
                                 .replace(/tel:/gi, '')
                                 .replace(/\s+/g, '')
                                 .replace(/[^\d+()-]/g, '')
                                 .trim();
                    // Validasi minimal 8 digit
                    if (phone && phone.replace(/[^\d]/g, '').length >= 8) {
                      break;
                    } else {
                      phone = ''; // Reset jika tidak valid
                    }
                  }
                }
              }
            }
            
              results.push({
                name,
              rating: rating || 'N/A',
              category: category || 'N/A',
              address: address || 'N/A',
              phone: phone || 'N/A', // Akan diisi dari detail page jika kosong
              email: 'N/A',
              capacity: 'N/A',
              detailUrl: detailUrl || ''
            });
          } catch (err) {
            console.error('Error parsing item:', err.message);
          }
        });

        return results;
      }, maxResults);

      console.log(`✅ Found ${businesses.length} businesses`);

      // Scrape phone numbers dari detail page dengan 5 tab paralel
      console.log('📞 Extracting phone numbers from detail pages (5 tabs parallel)...');
      let phoneCount = 0;
      
      // Filter businesses yang perlu di-scrape detail
      const businessesToScrape = businesses.map((business, index) => ({
        business,
        index,
        needsPhone: !business.phone || business.phone === 'N/A'
      })).filter(item => item.needsPhone);

      console.log(`📊 Total businesses to scrape: ${businessesToScrape.length} out of ${businesses.length}`);
      
      if (businessesToScrape.length === 0) {
        console.log('⚠️ No businesses need detail scraping, skipping...');
        await browser.close();
        return businesses;
      }
      
      const BATCH_SIZE = 5; // 5 tab paralel (10 terlalu berat, banyak race condition)
      const totalBatches = Math.ceil(businessesToScrape.length / BATCH_SIZE);
      console.log(`🚀 Will process ${businessesToScrape.length} businesses in ${totalBatches} batches (${BATCH_SIZE} tabs per batch)\n`);
      
      // Proses dalam batch 5 sekaligus
      for (let batchStart = 0; batchStart < businessesToScrape.length; batchStart += BATCH_SIZE) {
        const batch = businessesToScrape.slice(batchStart, batchStart + BATCH_SIZE);
        const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
        
        const batchBusinessNames = batch.map(({ business }) => business.name).join(', ');
        console.log(`\n🔥🔥🔥 Batch ${batchNumber}/${totalBatches}: Starting ${batch.length} tabs in PARALLEL for: ${batchBusinessNames}\n`);
        
        // Buat array untuk menyimpan semua promise - SEMUA AKAN DIMULAI SEKALIGUS
        const batchPromises = [];
        
        // Loop untuk membuat semua promise SEKALIGUS tanpa await
        for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
          const { business, index } = batch[batchIndex];
          // Buat async function dan langsung panggil (IIFE) - promise langsung dimulai
          const promise = (async () => {
            const tabId = `TAB-${index + 1}`;
            try {
              console.log(`🚀 [${tabId}] Starting PARALLEL scrape for: ${business.name}`);
              
              const { phone, email, capacity } = await this.getPhoneNumber(browser, page, business, index);

              if (phone && phone.length >= 8) {
                businesses[index].phone = phone;
                phoneCount++;
                console.log(`✅ [${tabId}] Found phone: ${phone} for ${business.name}`);
              } else {
                businesses[index].phone = 'N/A';
                console.log(`❌ [${tabId}] No phone found for: ${business.name}`);
              }

              if (email) {
                businesses[index].email = email;
                console.log(`📧 [${tabId}] Email: ${email} for ${business.name}`);
              } else if (!businesses[index].email || businesses[index].email === 'N/A') {
                businesses[index].email = 'N/A';
              }

              if (capacity) {
                businesses[index].capacity = capacity;
                console.log(`📊 [${tabId}] Capacity: ${capacity} for ${business.name}`);
              } else if (!businesses[index].capacity || businesses[index].capacity === 'N/A') {
                businesses[index].capacity = 'N/A';
              }
              
              console.log(`✅ [${tabId}] Completed: ${business.name}`);
              return { success: true, index, phone, email, capacity };
            } catch (err) {
              console.error(`❌ [${tabId}] Error getting phone for ${business.name}:`, err.message);
              businesses[index].phone = 'N/A';
              if (!businesses[index].email) {
                businesses[index].email = 'N/A';
              }
              if (!businesses[index].capacity) {
                businesses[index].capacity = 'N/A';
              }
              return { success: false, index, error: err.message };
            }
          })(); // IIFE langsung dieksekusi - promise dimulai SEKARANG JUGA!
          
          // Tambahkan promise ke array - semua promise sudah dimulai secara paralel
          batchPromises.push(promise);
          console.log(`⚡ [${index + 1}] Promise started and running in parallel for: ${business.name}`);
        }
        
        // Semua promise sudah dimulai secara paralel di atas
        // Sekarang tunggu semua selesai
        console.log(`⏳ Waiting for all ${batch.length} tabs to complete...\n`);
        const results = await Promise.all(batchPromises);
        console.log(`\n✅ Batch ${batchNumber}/${totalBatches} completed - Processed ${results.length} businesses\n`);
        
        // Delay antar batch untuk avoid detection dan give time untuk page state settle
        if (batchStart + BATCH_SIZE < businessesToScrape.length) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      console.log(`✅ Contact extraction completed: ${phoneCount}/${businesses.length} businesses have phone numbers`);

      await browser.close();
      return businesses;

    } catch (error) {
      console.error('❌ Scraping error:', error.message);
      if (browser) await browser.close();
      throw error;
    }
  }

  async scrollResults(page, maxResults) {
    const scrollableSelector = 'div[role="feed"]';
    
    try {
      let previousHeight = 0;
      let previousItemCount = 0;
      let noChangeCount = 0;
      const maxNoChange = 10; // Lebih sabar menunggu loading berikutnya
      let scrollCount = 0;
      const maxScrollAttempts = 100; // Safety limit untuk mencegah infinite loop
      
      console.log('🔄 Starting infinite scroll...');
      
      while (scrollCount < maxScrollAttempts) {
        // Scroll ke bawah
        const scrollResult = await page.evaluate((selector) => {
          const scrollable = document.querySelector(selector);
          if (scrollable) {
            const beforeHeight = scrollable.scrollHeight;
            const beforeScrollTop = scrollable.scrollTop;
            const scrollStep = Math.max(scrollable.clientHeight - 400, 400);
            scrollable.scrollBy(0, scrollStep);
            if (scrollable.scrollTop === beforeScrollTop) {
              scrollable.scrollTop = scrollable.scrollHeight;
            }
            
            // Tunggu sebentar untuk DOM update
            return {
              scrollHeight: scrollable.scrollHeight,
              scrollTop: scrollable.scrollTop,
              changed: scrollable.scrollTop !== beforeScrollTop || scrollable.scrollHeight !== beforeHeight
            };
          }
          return { scrollHeight: 0, scrollTop: 0, changed: false };
        }, scrollableSelector);
        
        // Tunggu konten baru ter-load
        await new Promise(resolve => setTimeout(resolve, 2500));

        // Klik tombol "More places" jika tersedia
        const clickedMorePlaces = await page.evaluate(() => {
          const button = document.querySelector('button[jsaction*="pane.paginationSection.morePlaces"], button[aria-label*="More places"], button[aria-label*="Lebih banyak tempat"]');
          if (button && !button.disabled) {
            button.click();
            return true;
          }
          return false;
        });
        if (clickedMorePlaces) {
          console.log('➡️ Clicked "More places" button to load additional results');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // Cek jumlah item yang sudah ter-load
        const currentItemCount = await page.evaluate(() => {
          return document.querySelectorAll('div[role="feed"] div[jsaction]').length;
        });
        
        const currentHeight = scrollResult.scrollHeight;
        
        // Cek apakah ada perubahan
        const hasHeightChange = currentHeight !== previousHeight;
        const hasItemChange = currentItemCount !== previousItemCount;
        
        if (hasHeightChange || hasItemChange) {
          // Ada perubahan, reset counter
          noChangeCount = 0;
          console.log(`📊 Scroll ${scrollCount + 1}: Found ${currentItemCount} items (height: ${currentHeight})`);
        } else {
          // Tidak ada perubahan
          noChangeCount++;
          console.log(`📊 Scroll ${scrollCount + 1}: No change (${noChangeCount}/${maxNoChange})`);
          
          if (noChangeCount >= maxNoChange) {
            console.log(`✅ Scroll completed: No new data after ${maxNoChange} consecutive scrolls`);
            console.log(`📊 Final count: ${currentItemCount} items`);
            break;
          }
        }
        
        if (maxResults && currentItemCount >= maxResults) {
          console.log(`✅ Reached requested maxResults limit (${maxResults})`);
          break;
        }
        
        previousHeight = currentHeight;
        previousItemCount = currentItemCount;
        scrollCount++;
        
        // Safety check: jika sudah banyak scroll tapi item count tidak berubah, break
        if (scrollCount > 10 && currentItemCount === previousItemCount && noChangeCount >= 3) {
          console.log(`✅ Scroll completed: Reached stable state`);
          break;
        }
      }
      
      if (scrollCount >= maxScrollAttempts) {
        console.log(`⚠️ Reached max scroll attempts (${maxScrollAttempts}), stopping`);
      }
      
      // Final wait untuk memastikan semua konten ter-load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`✅ Scroll finished after ${scrollCount} attempts`);
      
    } catch (err) {
      console.error('Scroll error:', err.message);
    }
  }

  // For Worker Pool - takes detail page only (no shared search page to avoid race condition)
  async getPhoneNumberWorker(browser, searchPage, detailPage, business, index) {
    if (!business) {
      return { phone: null, email: null, capacity: null };
    }

    const businessName = business.name || '';
    const detailUrl = business.detailUrl || '';

    const contactInfo = {
      phone: business.phone && business.phone !== 'N/A' ? business.phone : null,
      email: business.email && business.email !== 'N/A' ? business.email : null,
      capacity: business.capacity && business.capacity !== 'N/A' ? business.capacity : null,
    };

    if (detailUrl) {
      try {
        // Gunakan detailPage untuk scrape detail (setiap worker punya page sendiri - NO RACE CONDITION)
        const detailInfo = await this.getDetailInfoFromDetailUrlWithPage(detailPage, detailUrl, businessName);
        if (detailInfo) {
          if (!contactInfo.phone && detailInfo.phone && detailInfo.phone.length >= 8) {
            contactInfo.phone = detailInfo.phone;
          }
          if (!contactInfo.email && detailInfo.email) {
            contactInfo.email = detailInfo.email;
          }
          if (!contactInfo.capacity && detailInfo.capacity) {
            contactInfo.capacity = detailInfo.capacity;
          }
        }
      } catch (error) {
        console.warn(`⚠️ Gagal ambil nomor/link lewat detail URL (${businessName}): ${error.message}`);
      }
    }

    // SKIP FALLBACK getPhoneNumberFromList() karena:
    // 1. searchPage adalah SHARED untuk semua workers → RACE CONDITION!
    // 2. Detail URL sudah cukup reliable untuk mendapatkan phone
    // 3. Setiap worker punya detailPage sendiri → NO CONFLICT

    return contactInfo;
  }

  async getPhoneNumber(browser, page, business, index) {
    if (!business) {
      return { phone: null, email: null, capacity: null };
    }

    const businessName = business.name || '';
    const detailUrl = business.detailUrl || '';

    const contactInfo = {
      phone: business.phone && business.phone !== 'N/A' ? business.phone : null,
      email: business.email && business.email !== 'N/A' ? business.email : null,
      capacity: business.capacity && business.capacity !== 'N/A' ? business.capacity : null,
    };

    if (detailUrl) {
      try {
        const detailInfo = await this.getDetailInfoFromDetailUrl(browser, detailUrl, businessName);
        if (detailInfo) {
          if (!contactInfo.phone && detailInfo.phone && detailInfo.phone.length >= 8) {
            contactInfo.phone = detailInfo.phone;
          }
          if (!contactInfo.email && detailInfo.email) {
            contactInfo.email = detailInfo.email;
          }
          if (!contactInfo.capacity && detailInfo.capacity) {
            contactInfo.capacity = detailInfo.capacity;
          }
        }
      } catch (error) {
        console.warn(`⚠️ Gagal ambil nomor/link lewat detail URL (${businessName}): ${error.message}`);
      }
    }

    if (!contactInfo.phone) {
      const fallbackPhone = await this.getPhoneNumberFromList(page, businessName, index);
      if (fallbackPhone && fallbackPhone.length >= 8) {
        contactInfo.phone = fallbackPhone;
      }
    }

    return contactInfo;
  }

  // Extract detail info from already-loaded page
  async extractDetailInfo(detailPage, businessName) {
    try {
      const detailInfo = await detailPage.evaluate(() => {
        const normalizeNumber = (input) => {
          if (!input) return null;
          let cleaned = input.toString().trim();
          cleaned = cleaned.replace(/[()]/g, '').replace(/\s+/g, '').replace(/-/g, '');

          if (cleaned.startsWith('+62')) {
            cleaned = `0${cleaned.substring(3)}`;
          } else if (cleaned.startsWith('62')) {
            cleaned = `0${cleaned.substring(2)}`;
          }

          if (!cleaned.startsWith('0')) return null;
          if (!/^\d+$/.test(cleaned)) return null;

          if (cleaned.startsWith('08')) {
            if (cleaned.length >= 10 && cleaned.length <= 13) return cleaned;
            return null;
          }

          if (cleaned.length >= 9 && cleaned.length <= 12) {
            return cleaned;
          }

          return null;
        };

        const extractPhonesFromText = (text) => {
          if (!text || !text.trim()) return [];
          const normalized = text.replace(/\s+/g, ' ').trim();
          const matches = [];

          const patterns = [
            /\b(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})\b/g,
            /\b(08\d{8,10})\b/g,
            /(\+?62[\s-]?8\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
            /(\(?0[2-7]\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
            /\b(0[2-7]\d{8,10})\b/g,
            /(\+?62[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/g
          ];

          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(normalized)) !== null) {
              const normalizedPhone = normalizeNumber(match[1]);
              if (normalizedPhone) {
                matches.push(normalizedPhone);
              }
            }
          }

          return matches;
        };

        const addPhonesFromElement = (el, collector) => {
          if (!el) return;
          const dataId = el.getAttribute && el.getAttribute('data-item-id');
          if (dataId && dataId.includes('phone:tel:')) {
            const match = dataId.match(/phone:tel:(\+?\d+)/i);
            if (match && match[1]) {
              const normalizedPhone = normalizeNumber(match[1]);
              if (normalizedPhone) collector.add(normalizedPhone);
            }
          }

          const href = el.getAttribute && el.getAttribute('href');
          if (href && href.includes('tel:')) {
            const match = href.match(/tel:(\+?\d+)/i);
            if (match && match[1]) {
              const normalizedPhone = normalizeNumber(match[1]);
              if (normalizedPhone) collector.add(normalizedPhone);
            }
          }

          const text = (el.innerText || el.textContent || '').trim();
          if (text) {
            const phones = extractPhonesFromText(text);
            phones.forEach(p => collector.add(p));
          }
        };

        const foundPhones = new Set();

        // CRITICAL: Hanya cari phone di detail panel, bukan di seluruh page
        // Cari detail panel utama (biasanya punya h1 dengan nama bisnis)
        const detailPanel = document.querySelector('[role="main"]') || 
                           document.querySelector('div[jsaction*="pane"]') ||
                           document.querySelector('div.m6QErb') ||
                           document.querySelector('div[data-value]');
        
        const searchScope = detailPanel || document; // Fallback ke document jika panel tidak ditemukan
        
        // Hanya cari button dan link phone di detail panel
        searchScope.querySelectorAll('button.CsEnBe[data-item-id^="phone:tel:"]').forEach(el => addPhonesFromElement(el, foundPhones));
        searchScope.querySelectorAll('a[href^="tel:"], a[href*="tel:"]').forEach(el => addPhonesFromElement(el, foundPhones));
        
        const detailSelectors = [
          'div.Io6YTe',
          'div[class*="Io6YTe"]',
          'span.Io6YTe',
          'span[class*="Io6YTe"]',
          'button[aria-label*="Telepon"]',
          'button[aria-label*="Phone"]',
          'button[jsaction*="phone"]'
        ];
        detailSelectors.forEach(selector => {
          searchScope.querySelectorAll(selector).forEach(el => addPhonesFromElement(el, foundPhones));
        });

        // Hanya cari di detail panel, bukan di seluruh body
        // Ini mencegah mengambil nomor dari iklan, footer, atau elemen lain
        if (detailPanel) {
          const panelText = detailPanel.innerText || detailPanel.textContent || '';
          if (panelText) {
            const phones = extractPhonesFromText(panelText);
            phones.forEach(p => foundPhones.add(p));
          }
        } else {
          // Fallback: cari di elemen yang lebih spesifik (bukan semua div/span)
          const specificSelectors = [
            'div[class*="Io6YTe"]',
            'div[class*="fontBodyMedium"]',
            'div[class*="rogA2c"]',
            'div[class*="AeaXub"]'
          ];
          specificSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
              const text = el.innerText || el.textContent || '';
              if (text) {
                const phones = extractPhonesFromText(text);
                phones.forEach(p => foundPhones.add(p));
              }
            });
          });
        }

        const phonesArray = Array.from(foundPhones);
        let selectedPhone = null;

        if (phonesArray.length > 0) {
          const mobilePhones = phonesArray.filter(p => p.startsWith('08'));
          if (mobilePhones.length > 0) {
            selectedPhone = mobilePhones.reduce((best, phone) => (phone.length > best.length ? phone : best), mobilePhones[0]);
          } else {
            selectedPhone = phonesArray.reduce((best, phone) => (phone.length > best.length ? phone : best), phonesArray[0]);
          }
        }

        // Log untuk debugging
        if (selectedPhone) {
          console.log(`   📞 Found phone in detail panel: ${selectedPhone} (from ${phonesArray.length} candidates)`);
        } else {
          console.log(`   ⚠️ No phone found in detail panel (searched ${phonesArray.length} candidates)`);
        }

        // Extract Email
        const extractEmail = () => {
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const panelText = detailPanel ? (detailPanel.innerText || detailPanel.textContent || '') : '';
          const emails = panelText.match(emailRegex);
          
          if (emails && emails.length > 0) {
            return emails[0];
          }
          
          const mailtoLinks = searchScope.querySelectorAll('a[href^="mailto:"]');
          if (mailtoLinks.length > 0) {
            const href = mailtoLinks[0].getAttribute('href') || '';
            const emailMatch = href.match(/mailto:([^\?]+)/i);
            if (emailMatch && emailMatch[1]) {
              return emailMatch[1].trim();
            }
          }
          
          return null;
        };

        // Extract Capacity
        const extractCapacity = () => {
          const panelText = detailPanel ? (detailPanel.innerText || detailPanel.textContent || '').toLowerCase() : '';
          
          const besarKeywords = ['besar', 'large', 'pabrik', 'factory', 'industri', 'industrial', 'manufacturing', 'produksi massal', 'skala besar'];
          const sedangKeywords = ['sedang', 'medium', 'menengah', 'ukm', 'usaha kecil menengah'];
          const kecilKeywords = ['kecil', 'small', 'rumahan', 'home industry', 'home-based', 'usaha kecil'];
          
          for (const keyword of besarKeywords) {
            if (panelText.includes(keyword)) return 'Besar';
          }
          for (const keyword of sedangKeywords) {
            if (panelText.includes(keyword)) return 'Sedang';
          }
          for (const keyword of kecilKeywords) {
            if (panelText.includes(keyword)) return 'Kecil';
          }
          
          const employeePatterns = [
            /(\d+)\s*(karyawan|employee|pekerja|staff|tenaga kerja)/i,
            /(lebih dari|more than|over)\s*(\d+)\s*(karyawan|employee|pekerja)/i
          ];
          
          for (const pattern of employeePatterns) {
            const match = panelText.match(pattern);
            if (match) {
              const count = parseInt(match[1] || match[2] || '0');
              if (count > 100) return 'Besar';
              if (count > 20) return 'Sedang';
              if (count > 0) return 'Kecil';
            }
          }
          
          const areaPatterns = [
            /(\d+)\s*(hektar|hectare|ha)/i,
            /(\d+)\s*(m²|meter persegi|square meter)/i
          ];
          
          for (const pattern of areaPatterns) {
            const match = panelText.match(pattern);
            if (match) {
              const area = parseFloat(match[1] || '0');
              const unit = match[2]?.toLowerCase() || '';
              if (unit.includes('hektar') || unit.includes('ha')) {
                if (area > 5) return 'Besar';
                if (area > 1) return 'Sedang';
                return 'Kecil';
              } else {
                if (area > 10000) return 'Besar';
                if (area > 1000) return 'Sedang';
                if (area > 0) return 'Kecil';
              }
            }
          }
          
          return null;
        };

        const email = extractEmail();
        const capacity = extractCapacity();

        return {
          phone: selectedPhone || null,
          email: email || null,
          capacity: capacity || null,
        };
      });

      return detailInfo || { phone: null, email: null, capacity: null };
    } catch (error) {
      console.error(`❌ [EXTRACT] Error for ${businessName}:`, error.message);
      return null;
    }
  }

  // For Worker Pool - uses existing page
  async getDetailInfoFromDetailUrlWithPage(detailPage, detailUrl, businessName) {
    try {
      if (!detailUrl) return null;

      const normalizedUrl = detailUrl.startsWith('http')
        ? detailUrl
        : `https://www.google.com${detailUrl}`;

      console.log(`🚀 [WORKER] Using existing tab for: ${businessName}`);

      let navigationSucceeded = false;
      let lastNavigationError = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await detailPage.goto(normalizedUrl, {
            waitUntil: 'networkidle2',
            timeout: 120000
          });
          navigationSucceeded = true;
          break;
        } catch (error) {
          lastNavigationError = error;
          console.warn(
            `⚠️ Detail page navigation attempt ${attempt} failed for ${businessName}: ${error.message}`
          );
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        }
      }

      if (!navigationSucceeded) {
        throw lastNavigationError || new Error('Detail page navigation failed');
      }

      // Tunggu title atau tombol phone muncul
      await detailPage
        .waitForSelector('h1.DUwDvf, button.CsEnBe[data-item-id^="phone:tel:"], a[href^="tel:"], div.Io6YTe', { timeout: 10000 })
        .catch(() => {});

      await new Promise(resolve => setTimeout(resolve, 2000));

      // VALIDASI: Pastikan detail page yang di-load sesuai dengan business name
      const pageTitle = await detailPage.evaluate(() => {
        const titleEl = document.querySelector('h1.DUwDvf');
        return titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
      });

      if (pageTitle && businessName) {
        const titleLower = pageTitle.toLowerCase();
        const nameLower = businessName.toLowerCase();
        const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
        const matchingWords = nameWords.filter(w => titleLower.includes(w));
        
        // Validasi ketat: minimal 50% kata harus cocok untuk memastikan detail page benar
        const matchThreshold = Math.max(1, Math.ceil(nameWords.length * 0.5));
        if (nameWords.length > 0 && matchingWords.length < matchThreshold) {
          console.error(`❌ [WORKER] Detail page title TIDAK SESUAI! Expected: "${businessName}", Got: "${pageTitle}"`);
          console.error(`❌ [WORKER] URL: ${normalizedUrl.substring(0, 80)}...`);
          console.error(`❌ [WORKER] Only ${matchingWords.length}/${nameWords.length} words match (${(matchingWords.length/nameWords.length*100).toFixed(0)}%) - SKIPPING phone extraction untuk avoid wrong data`);
          // Return null untuk skip phone extraction - ini detail page yang salah!
          return { phone: null, instagram: null };
        } else {
          console.log(`✅ [WORKER] Detail page verified for: ${businessName} (Title: ${pageTitle.substring(0, 50)}...) - ${matchingWords.length}/${nameWords.length} words match`);
        }
      } else if (!pageTitle) {
        console.error(`❌ [WORKER] No page title found for ${businessName} - SKIPPING phone extraction (page mungkin tidak load dengan benar)`);
        // Return null untuk skip phone extraction
        return { phone: null, instagram: null };
      }

      // Scroll ringan untuk memicu lazy load
      await detailPage.evaluate(() => {
        const scrollTarget = document.querySelector('[role="main"]') || document.scrollingElement || document.body;
        if (scrollTarget) {
          const maxScroll = scrollTarget.scrollHeight - scrollTarget.clientHeight;
          const step = Math.max(scrollTarget.clientHeight - 200, 400);
          for (let pos = 0; pos <= maxScroll; pos += step) {
            scrollTarget.scrollTop = pos;
          }
          scrollTarget.scrollTop = 0;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      return await this.extractDetailInfo(detailPage, businessName);
    } catch (error) {
      console.error(`❌ [WORKER] Error extracting detail for ${businessName}:`, error.message);
      return null;
    }
  }

  async getDetailInfoFromDetailUrl(browser, detailUrl, businessName) {
    let detailPage;
    try {
      if (!detailUrl) return null;

      const normalizedUrl = detailUrl.startsWith('http')
        ? detailUrl
        : `https://www.google.com${detailUrl}`;

      console.log(`🚀 [PARALLEL] Creating new tab for: ${businessName}`);
      detailPage = await browser.newPage();
      await detailPage.setUserAgent(DEFAULT_USER_AGENT);
      await detailPage.setViewport({ width: 1920, height: 1080 });

      console.log(`➡️ [PARALLEL] Tab created, navigating to: ${businessName} - ${normalizedUrl.substring(0, 80)}...`);

      let navigationSucceeded = false;
      let lastNavigationError = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await detailPage.goto(normalizedUrl, {
            waitUntil: 'networkidle2',
            timeout: 120000
          });
          navigationSucceeded = true;
          break;
        } catch (error) {
          lastNavigationError = error;
          console.warn(
            `⚠️ Detail page navigation attempt ${attempt} failed for ${businessName}: ${error.message}`
          );
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        }
      }

      if (!navigationSucceeded) {
        throw lastNavigationError || new Error('Detail page navigation failed');
      }

      // Tunggu title atau tombol phone muncul
      await detailPage
        .waitForSelector('h1.DUwDvf, button.CsEnBe[data-item-id^="phone:tel:"], a[href^="tel:"], div.Io6YTe', { timeout: 10000 })
        .catch(() => {});

      await detailPage.waitForTimeout(2000);

      // Scroll ringan untuk memicu lazy load
      await detailPage.evaluate(() => {
        const scrollTarget = document.querySelector('[role="main"]') || document.scrollingElement || document.body;
        if (scrollTarget) {
          const maxScroll = scrollTarget.scrollHeight - scrollTarget.clientHeight;
          const step = Math.max(scrollTarget.clientHeight - 200, 400);
          for (let pos = 0; pos <= maxScroll; pos += step) {
            scrollTarget.scrollTop = pos;
          }
          scrollTarget.scrollTop = 0;
        }
      });

      await detailPage.waitForTimeout(1000);

      const detailInfo = await detailPage.evaluate(() => {
        const normalizeNumber = (input) => {
          if (!input) return null;
          let cleaned = input.toString().trim();
          cleaned = cleaned.replace(/[()]/g, '').replace(/\s+/g, '').replace(/-/g, '');

          if (cleaned.startsWith('+62')) {
            cleaned = `0${cleaned.substring(3)}`;
          } else if (cleaned.startsWith('62')) {
            cleaned = `0${cleaned.substring(2)}`;
          }

          if (!cleaned.startsWith('0')) return null;
          if (!/^\d+$/.test(cleaned)) return null;

          if (cleaned.startsWith('08')) {
            if (cleaned.length >= 10 && cleaned.length <= 13) return cleaned;
            return null;
          }

          if (cleaned.length >= 9 && cleaned.length <= 12) {
            return cleaned;
          }

          return null;
        };

        const extractPhonesFromText = (text) => {
          if (!text || !text.trim()) return [];
          const normalized = text.replace(/\s+/g, ' ').trim();
          const matches = [];

          const patterns = [
            /\b(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})\b/g,              // 08xx dengan separator
            /\b(08\d{8,10})\b/g,                                      // 08xx tanpa separator
            /(\+?62[\s-]?8\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,       // +62 8xx atau 62 8xx
            /(\(?0[2-7]\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/g,       // (021) 123 4567
            /\b(0[2-7]\d{8,10})\b/g,                                  // 02112345678
            /(\+?62[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/g         // +62 21 1234 5678
          ];

          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(normalized)) !== null) {
              const normalizedPhone = normalizeNumber(match[1]);
              if (normalizedPhone) {
                matches.push(normalizedPhone);
              }
            }
          }

          return matches;
        };

        const addPhonesFromElement = (el, collector) => {
          if (!el) return;
          const dataId = el.getAttribute && el.getAttribute('data-item-id');
          if (dataId && dataId.includes('phone:tel:')) {
            const match = dataId.match(/phone:tel:(\+?\d+)/i);
            if (match && match[1]) {
              const normalizedPhone = normalizeNumber(match[1]);
              if (normalizedPhone) collector.add(normalizedPhone);
            }
          }

          const href = el.getAttribute && el.getAttribute('href');
          if (href && href.includes('tel:')) {
            const match = href.match(/tel:(\+?\d+)/i);
            if (match && match[1]) {
              const normalizedPhone = normalizeNumber(match[1]);
              if (normalizedPhone) collector.add(normalizedPhone);
            }
          }

          const text = (el.innerText || el.textContent || '').trim();
          if (text) {
            const phones = extractPhonesFromText(text);
            phones.forEach(p => collector.add(p));
          }
        };

        const foundPhones = new Set();

        // Prioritas: tombol phone dan link tel
        document.querySelectorAll('button.CsEnBe[data-item-id^="phone:tel:"]').forEach(el => addPhonesFromElement(el, foundPhones));
        document.querySelectorAll('a[href^="tel:"], a[href*="tel:"]').forEach(el => addPhonesFromElement(el, foundPhones));

        // Cari di elemen teks yang umum
        const detailSelectors = [
          'div.Io6YTe',
          'div[class*="Io6YTe"]',
          'span.Io6YTe',
          'span[class*="Io6YTe"]',
          'button[aria-label*="Telepon"]',
          'button[aria-label*="Phone"]',
          'button[jsaction*="phone"]'
        ];
        detailSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => addPhonesFromElement(el, foundPhones));
        });

        // Fallback: scan teks di elemen umum
        const genericElements = document.querySelectorAll('div, span, p, li, td, th, label');
        for (const el of genericElements) {
          const text = el.innerText || el.textContent || '';
          if (!text) continue;
          const phones = extractPhonesFromText(text);
          phones.forEach(p => foundPhones.add(p));
        }

        // Fallback terakhir: body text
        const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        if (bodyText) {
          const phones = extractPhonesFromText(bodyText);
          phones.forEach(p => foundPhones.add(p));
        }

        const phonesArray = Array.from(foundPhones);
        let selectedPhone = null;

        if (phonesArray.length > 0) {
          const mobilePhones = phonesArray.filter(p => p.startsWith('08'));
          if (mobilePhones.length > 0) {
            selectedPhone = mobilePhones.reduce((best, phone) => (phone.length > best.length ? phone : best), mobilePhones[0]);
          } else {
            selectedPhone = phonesArray.reduce((best, phone) => (phone.length > best.length ? phone : best), phonesArray[0]);
          }
        }

        // Extract Email
        const extractEmail = () => {
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
          const emails = bodyText.match(emailRegex);
          
          if (emails && emails.length > 0) {
            // Filter email yang valid dan bukan dari domain umum yang tidak relevan
            const validEmails = emails.filter(email => {
              const domain = email.split('@')[1]?.toLowerCase();
              const excludeDomains = ['example.com', 'test.com', 'google.com', 'gmail.com', 'yahoo.com'];
              // Kita tetap ambil semua email, tapi prioritaskan yang bukan dari domain umum personal
              return true;
            });
            return validEmails.length > 0 ? validEmails[0] : null;
          }
          
          // Cari di link mailto
          const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
          if (mailtoLinks.length > 0) {
            const href = mailtoLinks[0].getAttribute('href') || '';
            const emailMatch = href.match(/mailto:([^\?]+)/i);
            if (emailMatch && emailMatch[1]) {
              return emailMatch[1].trim();
            }
          }
          
          return null;
        };

        // Extract Capacity (Kapasitas) - infer dari berbagai indikator
        const extractCapacity = () => {
          const bodyText = document.body ? (document.body.innerText || document.body.textContent || '').toLowerCase() : '';
          
          // Keywords untuk kapasitas besar
          const besarKeywords = ['besar', 'large', 'pabrik', 'factory', 'industri', 'industrial', 'manufacturing', 'produksi massal', 'skala besar'];
          // Keywords untuk kapasitas sedang
          const sedangKeywords = ['sedang', 'medium', 'menengah', 'ukm', 'usaha kecil menengah'];
          // Keywords untuk kapasitas kecil
          const kecilKeywords = ['kecil', 'small', 'rumahan', 'home industry', 'home-based', 'usaha kecil'];
          
          // Cek keyword kapasitas
          for (const keyword of besarKeywords) {
            if (bodyText.includes(keyword)) {
              return 'Besar';
            }
          }
          
          for (const keyword of sedangKeywords) {
            if (bodyText.includes(keyword)) {
              return 'Sedang';
            }
          }
          
          for (const keyword of kecilKeywords) {
            if (bodyText.includes(keyword)) {
              return 'Kecil';
            }
          }
          
          // Infer dari jumlah karyawan jika disebutkan
          const employeePatterns = [
            /(\d+)\s*(karyawan|employee|pekerja|staff|tenaga kerja)/i,
            /(lebih dari|more than|over)\s*(\d+)\s*(karyawan|employee|pekerja)/i
          ];
          
          for (const pattern of employeePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              const count = parseInt(match[1] || match[2] || '0');
              if (count > 100) return 'Besar';
              if (count > 20) return 'Sedang';
              if (count > 0) return 'Kecil';
            }
          }
          
          // Infer dari luas area jika disebutkan (dalam m² atau hektar)
          const areaPatterns = [
            /(\d+)\s*(hektar|hectare|ha)/i,
            /(\d+)\s*(m²|meter persegi|square meter)/i
          ];
          
          for (const pattern of areaPatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              const area = parseFloat(match[1] || '0');
              const unit = match[2]?.toLowerCase() || '';
              if (unit.includes('hektar') || unit.includes('ha')) {
                if (area > 5) return 'Besar';
                if (area > 1) return 'Sedang';
                return 'Kecil';
              } else {
                // meter persegi
                if (area > 10000) return 'Besar';
                if (area > 1000) return 'Sedang';
                if (area > 0) return 'Kecil';
              }
            }
          }
          
          return null;
        };

        const email = extractEmail();
        const capacity = extractCapacity();

        return {
          phone: selectedPhone || null,
          email: email || null,
          capacity: capacity || null,
        };
      });

      return detailInfo || { phone: null, email: null, capacity: null };
    } catch (error) {
      console.warn(`⚠️ Detail page extraction error for ${businessName}: ${error.message}`);
      return null;
    } finally {
      if (detailPage) {
        try {
          await detailPage.close();
        } catch (closeError) {
          console.warn(`⚠️ Failed to close detail page for ${businessName}: ${closeError.message}`);
        }
      }
    }
  }

  async getPhoneNumberFromList(page, businessName, index) {
    try {
      // Scroll ke elemen terlebih dahulu untuk memastikan terlihat
      await page.evaluate((idx) => {
        const items = Array.from(document.querySelectorAll('div[role="feed"] div[jsaction]'));
        if (items[idx]) {
          items[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, index);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Cari elemen bisnis di list view berdasarkan index/nama dan klik elemen yang benar (card/anchor)
      const clicked = await page.evaluate((name, idx) => {
        const getListItems = () => {
          // Urutan prioritas selector untuk cards di panel kiri
          const selectors = [
            'div[role="feed"] .Nv2PK',                    // card utama (Maps modern)
            'div[role="feed"] a.hfpxzc',                  // anchor clickable
            'div[role="feed"] > div > div[jsaction]',     // fallback lama
          ];
          for (const sel of selectors) {
            const els = Array.from(document.querySelectorAll(sel));
            if (els.length > 0) return els;
          }
          return [];
        };

        const clickElement = (el) => {
          if (!el) return false;
          const anchor = el.querySelector('a.hfpxzc');
          const target = anchor || el;
          target.scrollIntoView({ behavior: 'auto', block: 'center' });
          target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          target.click();
          return true;
        };

        const items = getListItems();
        // PRIORITAS: Berdasarkan NAMA terlebih dahulu (lebih reliable saat parallel)
        if (name) {
          for (const el of items) {
            const nameEl = el.querySelector('div.fontHeadlineSmall, [class*="fontHeadline"], .qBF1Pd');
            const text = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
            if (text && text.toLowerCase() === (name || '').toLowerCase()) {
              return clickElement(el);
            }
          }
        }
        // Fallback: Berdasarkan index
        if (items[idx]) {
          return clickElement(items[idx]);
        }
        return false;
      }, businessName, index);
      
      if (!clicked) {
        console.log(`⚠️ Could not find business element: ${businessName}`);
        return null;
      }
      
      // Tunggu detail panel muncul - tunggu lebih lama dan coba berbagai selector
      let panelOpen = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt < 3 ? 1500 : 2000));
        
        panelOpen = await page.evaluate((expectedName) => {
          // Cari semua kemungkinan panel
          const panels = document.querySelectorAll('[role="main"], div[jsaction*="pane"], div.m6QErb');
          
          for (const panel of panels) {
            // Cari title di panel ini
            const titleEl = panel.querySelector('h1.DUwDvf, .DUwDvf');
            if (titleEl) {
              const title = (titleEl.innerText || titleEl.textContent || '').trim().toLowerCase();
            const expected = (expectedName || '').toLowerCase();
              
              if (expected && title) {
                // Verifikasi dengan mencocokkan kata-kata penting
                const titleWords = title.split(/\s+/).filter(w => w.length > 2);
                const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
                const matchingWords = titleWords.filter(w => expectedWords.some(ew => ew.includes(w) || w.includes(ew)));
                
                // Jika ada cukup kata yang cocok, ini detail panel yang benar
                if (matchingWords.length >= Math.min(2, Math.max(1, expectedWords.length / 2))) {
                  // Verifikasi ini bukan search results
                  const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
                  const hasTabs = panel.querySelector('button[role="tab"]') !== null;
                  
                  // Detail panel biasanya punya tabs atau tidak punya search feed
                  if (hasTabs || !hasSearchFeed) {
              return true;
            }
          }
              }
            }
          }
          
          // Fallback: cek apakah ada panel dengan tabs (biasanya detail panel)
          const panelWithTabs = Array.from(panels).find(p => {
            return p.querySelectorAll('button[role="tab"]').length > 0 && 
                   !p.querySelector('div[role="feed"]');
          });
          
          return !!panelWithTabs;
        }, businessName);
        
        if (panelOpen) {
          console.log(`✅ Detail panel terbuka untuk: ${businessName} (attempt ${attempt + 1})`);
          break;
        }
        
        // Jika belum terbuka, coba klik lagi
        if (attempt < 9) {
          await page.evaluate((idx) => {
            const items = Array.from(document.querySelectorAll('div[role="feed"] .Nv2PK, div[role="feed"] a.hfpxzc, div[role="feed"] > div > div[jsaction]'));
            if (items[idx]) {
              const el = items[idx];
              const anchor = el.querySelector('a.hfpxzc');
              (anchor || el).click();
            }
          }, index);
        }
      }
      
      if (!panelOpen) {
        console.log(`⚠️ Detail panel tidak terbuka untuk: ${businessName} setelah beberapa attempts`);
        // Tetap lanjutkan, mungkin elemen sudah ada tapi selector berbeda
      }
      
      // Tunggu lagi untuk memastikan konten ter-load dengan benar
      console.log(`⏳ Waiting for detail panel content to load...`);
      
      // Tunggu dan verifikasi konten detail panel sudah ter-load
      for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
        await new Promise(resolve => setTimeout(resolve, waitAttempt < 3 ? 1000 : 1500));
        
        const contentLoaded = await page.evaluate((expectedName) => {
          // Cari detail panel
          const panels = document.querySelectorAll('[role="main"], div[jsaction*="pane"], div.m6QErb');
          
          for (const panel of panels) {
            const titleEl = panel.querySelector('h1.DUwDvf');
            if (!titleEl) continue;
            
            const title = (titleEl.innerText || titleEl.textContent || '').trim().toLowerCase();
            const expected = (expectedName || '').toLowerCase();
            
            if (expected && title) {
              const titleWords = title.split(/\s+/).filter(w => w.length > 2);
              const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
              const matchingWords = titleWords.filter(w => expectedWords.some(ew => ew.includes(w) || w.includes(ew)));
              
              if (matchingWords.length >= Math.min(2, Math.max(1, expectedWords.length / 2))) {
                // Cek apakah ada konten detail (Io6YTe, tombol phone, atau tabs)
                const hasDetailContent = panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe, button[role="tab"]').length > 0;
                const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
                
                if (hasDetailContent && !hasSearchFeed) {
              return true;
            }
          }
            }
          }
          
          return false;
        }, businessName);
        
        if (contentLoaded) {
          console.log(`✅ Detail panel content loaded untuk: ${businessName}`);
          break;
        }
      }
      
      // Scroll lebih agresif untuk memastikan konten ter-load (beberapa elemen mungkin di bawah fold)
      await page.evaluate(() => {
        const panel = document.querySelector('[role="main"], div[jsaction*="pane"], div.m6QErb');
        if (panel && panel.scrollHeight > panel.clientHeight) {
          // Scroll bertahap untuk memastikan semua konten ter-load
          const scrollSteps = 8;
          const scrollAmount = panel.scrollHeight / scrollSteps;
          for (let i = 0; i <= scrollSteps; i++) {
            panel.scrollTop = scrollAmount * i;
          }
          // Kembali ke atas untuk memastikan semua elemen ter-render
          panel.scrollTop = 0;
          // Scroll lagi ke tengah
          panel.scrollTop = panel.scrollHeight / 2;
          // Kembali ke bawah
          panel.scrollTop = panel.scrollHeight;
        }
      });
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      // Scroll lagi dengan lebih banyak step untuk memastikan konten yang perlu scroll ter-load
      await page.evaluate(() => {
        const panel = document.querySelector('[role="main"], div[jsaction*="pane"], div.m6QErb');
        if (panel && panel.scrollHeight > panel.clientHeight) {
          // Multiple scroll passes untuk trigger lazy loading
          for (let pass = 0; pass < 3; pass++) {
            panel.scrollTop = 0;
            panel.scrollTop = panel.scrollHeight;
          }
        }
      });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // PENTING: Cari nomor telepon dulu di tab default (Ringkasan/Overview) 
      // karena nomor telepon biasanya ada di sana, BUKAN di tab About/Tentang
      // Hanya pindah ke tab lain kalau tidak ketemu di tab default

      // Scroll dan cari nomor telepon secara bertahap di panel detail (beberapa data berada di bawah fold)
      const tryFindPhoneWithScrolling = async () => {
        // Polling cepat untuk elemen tombol telepon yang sering ada
        for (let p = 0; p < 6; p++) {
          const immediate = await page.evaluate(() => {
            const btn = document.querySelector('button.CsEnBe[data-item-id^="phone:tel:"]');
            if (btn) {
              const dataId = btn.getAttribute('data-item-id') || '';
              const match = dataId.match(/phone:tel:(\+?\d+)/i);
              if (match && match[1]) {
                return { phone: match[1], selector: 'button.CsEnBe[data-item-id^="phone:tel:"]' };
              }
              const visible = btn.querySelector('.rogA2c .Io6YTe');
              const text = visible ? (visible.innerText || visible.textContent || '').trim() : '';
              if (text) {
                const cleaned = text.replace(/\s+/g, '').replace(/-/g, '').replace(/[^\d+()-]/g, '');
                if (cleaned.replace(/[^\d]/g, '').length >= 8) {
                  return { phone: cleaned, selector: 'button.CsEnBe .rogA2c .Io6YTe' };
                }
              }
            }
            return null;
          });
          if (immediate && immediate.phone) {
            return immediate;
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // Lakukan scroll bertahap pada panel detail sambil mencari nomor
        for (let s = 0; s < 12; s++) {
          const found = await page.evaluate(() => {
            const debug = [];
            const findPhone = () => {
              // Prioritas: tombol phone
              const phoneButton = document.querySelector('button.CsEnBe[data-item-id^="phone:tel:"]');
        if (phoneButton) {
                const dataId = phoneButton.getAttribute('data-item-id') || '';
                const match = dataId.match(/phone:tel:(\+?\d+)/i);
                if (match && match[1]) return { phone: match[1], selector: 'button.CsEnBe[data-item-id^="phone:tel:"]' };
                const visible = phoneButton.querySelector('.rogA2c .Io6YTe');
                const text = visible ? (visible.innerText || visible.textContent || '').trim() : '';
                if (text) {
                  const cleaned = text.replace(/\s+/g, '').replace(/-/g, '').replace(/[^\d+()-]/g, '');
                  if (cleaned.replace(/[^\d]/g, '').length >= 8) return { phone: cleaned, selector: 'button.CsEnBe .rogA2c .Io6YTe' };
                }
              }
              // Class Io6YTe di panel
              const candidates = document.querySelectorAll('div.Io6YTe.fontBodyMedium, div.Io6YTe, div[class*="Io6YTe"]');
              for (const el of candidates) {
                const t = (el.innerText || el.textContent || '').trim();
                if (!t) continue;
                
                // Cek pattern dengan dash/spasi
                let phoneMatch = t.match(/(\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,6})/);
                if (phoneMatch) {
                  const cleaned = phoneMatch[1].replace(/\s+/g, '').replace(/-/g, '').trim();
                  if (cleaned.length >= 10 && cleaned.length <= 15) {
                    return { phone: cleaned, selector: 'div.Io6YTe*' };
                  }
                }
                
                // Cek pattern tanpa dash (10-13 digits)
                phoneMatch = t.match(/\b(0\d{9,12})\b/);
                if (phoneMatch && phoneMatch[1].startsWith('0')) {
                  return { phone: phoneMatch[1], selector: 'div.Io6YTe*' };
                }
                
                // Fallback: bersihkan dan cek
                const cleaned = t.replace(/\s+/g, '').replace(/-/g, '').replace(/[^\d+()-]/g, '');
                if (cleaned.length >= 10 && cleaned.length <= 15 && /^[\d+()-]+$/.test(cleaned) && cleaned.match(/^(\+?62|0)\d+$/)) {
                  return { phone: cleaned, selector: 'div.Io6YTe*' };
                }
              }
              
              // Juga cari di semua DIV yang hanya berisi nomor
              const allDivs = document.querySelectorAll('div');
              for (const div of allDivs) {
                const text = (div.innerText || div.textContent || '').trim();
                if (text && /^[\d\s\-+()]{10,15}$/.test(text)) {
                  const phoneMatch = text.match(/\b(0\d{9,12})\b/) || text.match(/(\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,6})/);
                  if (phoneMatch) {
                    const cleaned = phoneMatch[1].replace(/\s+/g, '').replace(/-/g, '').trim();
                    if (cleaned.length >= 10 && cleaned.length <= 15 && cleaned.startsWith('0')) {
                      return { phone: cleaned, selector: 'div (phone-only)' };
                    }
                  }
                }
              }
              // Link tel:
              const tel = document.querySelector('a[href^="tel:"], a[href*="tel:"]');
              if (tel) {
                const href = tel.getAttribute('href') || '';
                const m = href.match(/tel:(\+?\d+)/i);
                if (m && m[1]) return { phone: m[1], selector: 'a[href^="tel:"]' };
              }
              return null;
            };

            const result = findPhone();
            if (result) return { found: true, result };

            // Scroll 1 layar pada panel detail
            const panel = document.querySelector('div.m6QErb.XiKgde[role="region"]') || document.querySelector('[role="main"]') || document.querySelector('div[jsaction*="pane"]');
            if (panel) {
              const before = panel.scrollTop;
              panel.scrollTop = Math.min(panel.scrollTop + panel.clientHeight - 40, panel.scrollHeight);
              return { found: false, scrolled: panel.scrollTop !== before };
            }
            return { found: false, scrolled: false };
          });
          if (found && found.found) return found.result;
          await new Promise(r => setTimeout(r, 600));
        }
        return null;
      };
      
      // Cari nomor telepon dengan berbagai selector yang lebih spesifik
      // Pertama, coba cepat dengan polling & scroll bertahap
      const scrolledImmediate = await tryFindPhoneWithScrolling();
      if (scrolledImmediate && scrolledImmediate.phone) {
        return scrolledImmediate.phone;
      }

      // Jika belum ketemu, lanjutkan dengan strategi evaluate komprehensif
      // Verifikasi detail panel dan ambil hanya di dalam panel detail yang benar
      const phoneResult = await page.evaluate((expectedBusinessName) => {
        const debugLog = [];
        
        // Cari detail panel yang benar (bukan hasil pencarian)
        // Detail panel biasanya memiliki struktur spesifik
        const findDetailPanel = () => {
          // Strategi 1: Cari panel yang memiliki title (h1.DUwDvf) yang sesuai dengan nama bisnis
          const allPanels = document.querySelectorAll('[role="main"], div[jsaction*="pane"], div.m6QErb, div[role="region"]');
          
          for (const panel of allPanels) {
            const title = panel.querySelector('h1.DUwDvf');
            if (title) {
              const titleText = (title.innerText || title.textContent || '').trim().toLowerCase();
              const expected = (expectedBusinessName || '').toLowerCase();
              
              // Verifikasi nama bisnis cocok
              if (expected && titleText) {
                // Cek apakah title mengandung nama bisnis atau sebaliknya
                const titleWords = titleText.split(/\s+/).filter(w => w.length > 2);
                const expectedWords = expected.split(/\s+/).filter(w => w.length > 2);
                const matchingWords = titleWords.filter(w => expectedWords.some(ew => ew.includes(w) || w.includes(ew)));
                
                // Jika ada beberapa kata yang cocok, kemungkinan ini detail panel yang benar
                // Lebih fleksibel: minimal 1 kata cocok untuk nama pendek, atau 2 kata untuk nama panjang
                const minMatches = expectedWords.length <= 2 ? 1 : Math.min(2, Math.max(1, Math.floor(expectedWords.length / 2)));
                
                if (matchingWords.length >= minMatches || title.includes(expected.substring(0, Math.min(5, expected.length))) || expected.includes(title.substring(0, Math.min(5, title.length)))) {
                  // Verifikasi ini bukan hasil pencarian
                  const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
                  const hasTabs = panel.querySelector('button[role="tab"]') !== null;
                  
                  // Detail panel biasanya punya tabs, bukan search feed
                  if (hasTabs && !hasSearchFeed) {
                    return panel;
                  } else if (!hasSearchFeed && panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe').length > 0) {
                    // Atau jika ada Io6YTe elements atau tombol phone (biasanya ada di detail panel)
                    return panel;
                  } else if (!hasSearchFeed && titleWords.length > 0) {
                    // Atau jika tidak ada search feed dan ada title (lebih fleksibel)
                    return panel;
                  }
                }
              }
            }
          }
          
          // Strategi 2: Cari panel yang memiliki tab buttons dan tidak memiliki search results feed
          const panelsWithTabs = Array.from(document.querySelectorAll('[role="main"], div[jsaction*="pane"], div.m6QErb'));
          for (const panel of panelsWithTabs) {
            const hasTabs = panel.querySelectorAll('button[role="tab"]').length > 0;
            const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
            const hasTitle = panel.querySelector('h1.DUwDvf') !== null;
            
            // Detail panel biasanya: punya tabs, punya title, tidak punya search feed
            if (hasTabs && hasTitle && !hasSearchFeed) {
              return panel;
            }
            // Atau: punya tabs, tidak punya search feed (lebih fleksibel)
            if (hasTabs && !hasSearchFeed) {
              // Verifikasi dengan melihat apakah ada Io6YTe atau elemen detail lainnya
              const hasDetailElements = panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe').length > 0;
              if (hasDetailElements) {
                return panel;
              }
            }
          }
          
          // Strategi 3: Cari panel yang memiliki elemen detail spesifik (tombol phone, Io6YTe, dll)
          for (const panel of allPanels) {
            const hasPhoneButton = panel.querySelector('button.CsEnBe[data-item-id*="phone"]') !== null;
            const hasIo6Elements = panel.querySelectorAll('[class*="Io6YTe"]').length > 0;
            const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
            
            // Jika ada elemen detail dan bukan search feed, kemungkinan ini detail panel
            if ((hasPhoneButton || hasIo6Elements) && !hasSearchFeed) {
              return panel;
            }
          }
          
          // Strategi 4: Fallback - ambil panel yang memiliki konten paling banyak dan tidak memiliki search feed
          let bestPanel = null;
          let maxDetailElements = 0;
          
          for (const panel of allPanels) {
            const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
            if (hasSearchFeed) continue; // Skip jika ada search feed
            
            const detailCount = panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe, h1.DUwDvf, button[role="tab"]').length;
            if (detailCount > maxDetailElements) {
              maxDetailElements = detailCount;
              bestPanel = panel;
            }
          }
          
          if (bestPanel && maxDetailElements > 5) {
            return bestPanel;
          }
          
          return null;
        };
        
        let detailPanel = findDetailPanel();
        
        // Jika detail panel tidak ditemukan, gunakan fallback panel
        if (!detailPanel) {
          debugLog.push('Detail panel tidak ditemukan dengan kriteria ketat, menggunakan fallback panel');
          
          // Fallback: cari panel yang paling mungkin adalah detail panel
          const fallbackPanels = document.querySelectorAll('[role="main"], div[jsaction*="pane"], div.m6QErb');
          for (const panel of fallbackPanels) {
            // Skip jika jelas-jelas search results
            const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
            if (hasSearchFeed) continue;
            
            // Cek apakah ada elemen yang menunjukkan ini detail panel
            const hasTitle = panel.querySelector('h1.DUwDvf') !== null;
            const hasTabs = panel.querySelectorAll('button[role="tab"]').length > 0;
            const hasDetailElements = panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe').length > 0;
            
            // Jika ada indikasi detail panel, gunakan ini
            if ((hasTitle || hasTabs) && hasDetailElements) {
              detailPanel = panel;
              debugLog.push('Menggunakan fallback panel dengan indikasi detail content');
              break;
            }
          }
          
          // Jika masih tidak ada, gunakan panel pertama yang tidak memiliki search feed
          if (!detailPanel) {
            for (const panel of fallbackPanels) {
              const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
              if (!hasSearchFeed && panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe, h1.DUwDvf').length > 0) {
                detailPanel = panel;
                debugLog.push('Menggunakan fallback panel generik');
                break;
              }
            }
          }
        }
        
        if (!detailPanel) {
          debugLog.push('Tidak ada panel yang bisa digunakan untuk mencari nomor telepon');
          return { phone: null, debugLog: debugLog };
        }
        
        debugLog.push(`Panel ditemukan, mencari nomor telepon di dalamnya`);
        
        // PRIORITY: Ambil langsung dari tombol phone (sesuai struktur terbaru)
        // <button class="CsEnBe" data-item-id="phone:tel:081237236716"> ... <div class="rogA2c"><div class="Io6YTe fontBodyMedium ...">0812-3723-6716</div>
        try {
          const phoneButton = detailPanel.querySelector('button.CsEnBe[data-item-id^="phone:tel:"]');
          if (phoneButton) {
            const dataId = phoneButton.getAttribute('data-item-id') || '';
            const match = dataId.match(/phone:tel:(\+?\d+)/i);
            if (match && match[1]) {
              const phoneNum = match[1].trim();
              debugLog.push('Found by button.CsEnBe[data-item-id^="phone:tel:"] via data-id');
              return { phone: phoneNum, selector: 'button.CsEnBe[data-item-id^="phone:tel:"]', text: dataId, debugLog };
            }

            // Coba ambil dari visible text di dalam tombol
            const visible = phoneButton.querySelector('.rogA2c .Io6YTe');
            const text = visible ? (visible.innerText || visible.textContent || '').trim() : '';
            if (text) {
              const cleaned = text.replace(/\s+/g, '').replace(/-/g, '').replace(/[^\d+()-]/g, '');
              if (cleaned.replace(/[^\d]/g, '').length >= 8) {
                debugLog.push('Found by button.CsEnBe > .rogA2c .Io6YTe');
                return { phone: cleaned, selector: 'button.CsEnBe .rogA2c .Io6YTe', text, debugLog };
              }
            }
          }
        } catch (e) {
          debugLog.push(`Error reading CsEnBe phone button: ${e.message}`);
        }
        
        // Helper function untuk extract phone number dari text
        // PRIORITAS: Nomor HP (08xx) lebih diprioritaskan daripada nomor telepon kantor
        const extractPhoneFromText = (text) => {
          if (!text || !text.trim()) return null;
          
          // Normalize text: remove extra whitespace
          const normalized = text.trim();
          
          // PRIORITY 1: Nomor HP (08xx) - Format tanpa dash/spasi (081234567890, 0812-3456-7890, 0812 3456 7890)
          // Pattern untuk nomor HP yang dimulai dengan 08 - DIPRIORITASKAN
          const hpPattern08 = normalized.match(/\b(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})\b/);
          if (hpPattern08) {
            const cleaned = hpPattern08[1].replace(/\s+/g, '').replace(/-/g, '').trim();
            if (cleaned.length >= 10 && cleaned.length <= 13 && cleaned.startsWith('08')) {
              return cleaned;
            }
          }
          
          // PRIORITY 2: Nomor HP (08xx) - Format panjang tanpa separator
          const hpPattern08Long = normalized.match(/\b(08\d{8,10})\b/);
          if (hpPattern08Long) {
            const num = hpPattern08Long[1];
            if (num.length >= 10 && num.length <= 13) {
              return num;
            }
          }
          
          // PRIORITY 3: Nomor HP dengan format +62 8xx atau 62 8xx
          const hpPattern62 = normalized.match(/(\+?62[\s-]?8\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/);
          if (hpPattern62) {
            let cleaned = hpPattern62[1].replace(/\s+/g, '').replace(/-/g, '').trim();
            if (cleaned.startsWith('+62') && cleaned.length >= 12) {
              cleaned = '0' + cleaned.substring(3);
            } else if (cleaned.startsWith('62') && cleaned.length >= 11 && !cleaned.startsWith('+62')) {
              cleaned = '0' + cleaned.substring(2);
            }
            if (cleaned.length >= 10 && cleaned.length <= 13 && cleaned.startsWith('08')) {
              return cleaned;
            }
          }
          
          // PRIORITY 4: Semua nomor HP yang dimulai dengan 08 (catch-all) - cari semua yang ada
          const allHpNumbers = normalized.match(/\b(08\d{8,10})\b/g);
          if (allHpNumbers && allHpNumbers.length > 0) {
            // Ambil yang pertama dan paling lengkap
            const longestHp = allHpNumbers.reduce((a, b) => a.length > b.length ? a : b);
            if (longestHp.length >= 10 && longestHp.length <= 13) {
              return longestHp;
            }
          }
          
          // PRIORITY 5: Format dengan dash/spasi untuk nomor HP (0812-3723-6716 atau 0812 3723 6716)
          const dashPatternHp = normalized.match(/(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,6})/);
          if (dashPatternHp) {
            const cleaned = dashPatternHp[1].replace(/\s+/g, '').replace(/-/g, '').trim();
            if (cleaned.length >= 10 && cleaned.length <= 13 && cleaned.startsWith('08')) {
              return cleaned;
            }
          }
          
          // FALLBACK 1: Nomor telepon kantor dengan tanda kurung (021) 1234-5678 atau (021)12345678
          const landlinePattern = normalized.match(/(\(?0[2-7]\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/);
          if (landlinePattern) {
            let cleaned = landlinePattern[1].replace(/[()]/g, '').replace(/\s+/g, '').replace(/-/g, '').trim();
            // Validasi: nomor telepon kantor biasanya dimulai dengan 02x, 03x, 04x, 05x, 06x, 07x (bukan 08)
            if (cleaned.length >= 9 && cleaned.length <= 12 && !cleaned.startsWith('08')) {
              return cleaned;
            }
          }
          
          // FALLBACK 2: Format tanpa dash untuk nomor lain (bukan 08) - 10-13 digits
          const noDashPattern = normalized.match(/\b(0[2-7]\d{8,10})\b/);
          if (noDashPattern) {
            const num = noDashPattern[1];
            // Skip jika sudah 08 (sudah di-handle di atas), hanya ambil telepon kantor (02x-07x)
            if (!num.startsWith('08') && num.length >= 10 && num.length <= 12) {
              return num;
            }
          }
          
          // FALLBACK 3: Format +62 untuk nomor HP atau telepon kantor (jika belum ketemu 08)
          const indonesiaPattern = normalized.match(/(\+?62[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/);
          if (indonesiaPattern) {
            let cleaned = indonesiaPattern[1].replace(/\s+/g, '').replace(/-/g, '').trim();
            // Normalize +62 menjadi 0
            if (cleaned.startsWith('+62') && cleaned.length >= 12) {
              cleaned = '0' + cleaned.substring(3);
            } else if (cleaned.startsWith('62') && cleaned.length >= 11 && !cleaned.startsWith('+62')) {
              cleaned = '0' + cleaned.substring(2);
            }
            if (cleaned.length >= 10 && cleaned.length <= 13) {
              // Prioritas ke 08 jika ada
              if (cleaned.startsWith('08')) {
                return cleaned;
              }
              // Fallback ke nomor lain jika tidak ada 08
              return cleaned;
            }
          }
          
          // FALLBACK 4: Bersihkan text dan cek apakah hanya angka/karakter telepon
          let cleaned = normalized.replace(/\s+/g, '').replace(/-/g, '').replace(/[^\d+()-]/g, '').trim();
          
          // Remove parentheses jika ada
          cleaned = cleaned.replace(/[()]/g, '');
          
          if (cleaned.length >= 10 && cleaned.length <= 15 && /^[\d+]+$/.test(cleaned)) {
            // Normalize +62 menjadi 0
            if (cleaned.startsWith('+62') && cleaned.length >= 12) {
              cleaned = '0' + cleaned.substring(3);
            } else if (cleaned.startsWith('62') && cleaned.length >= 11 && !cleaned.startsWith('+62')) {
              cleaned = '0' + cleaned.substring(2);
            }
            // Prioritas ke 08 jika ada
            if (cleaned.match(/^08\d{8,10}$/)) {
              return cleaned;
            }
            // Fallback ke nomor lain jika tidak ada 08
            if (cleaned.match(/^0\d{9,12}$/)) {
              return cleaned;
            }
          }
          
          // FALLBACK 5: Cari dalam text yang mungkin memiliki prefix seperti "Tel:", "Phone:", "HP:", dll
          const withPrefixPattern = normalized.match(/(?:tel|phone|hp|wa|whatsapp|mobile)[\s:]*([\d\s\-+()]{10,15})/i);
          if (withPrefixPattern && withPrefixPattern[1]) {
            const phoneNum = extractPhoneFromText(withPrefixPattern[1]);
            if (phoneNum) return phoneNum;
          }
          
          return null;
        };
        
        // Method 0: Cari langsung di div dengan class Io6YTe (selector spesifik Google Maps)
        // Berdasarkan elemen yang user berikan: <div class="Io6YTe fontBodyMedium kR99db fdkmkc ">0812-3723-6716</div>
        const selectors = [
          'div.Io6YTe.fontBodyMedium',  // Kombinasi class yang user berikan
          'div[class*="Io6YTe"][class*="fontBodyMedium"]',  // Partial match
          'div.Io6YTe',  // Hanya Io6YTe
          'div[class*="Io6YTe"]',  // Contains Io6YTe
          '.Io6YTe',  // Class selector
          'div.fontBodyMedium.Io6YTe',  // Reverse order
          'div[class*="Io6YTe"].fontBodyMedium'  // Another variant
        ];
        
        for (const selector of selectors) {
          try {
            const phoneDivs = detailPanel.querySelectorAll(selector);
            
            if (phoneDivs.length > 0) {
              debugLog.push(`Found ${phoneDivs.length} elements with selector: ${selector}`);
            }
            
            for (const div of phoneDivs) {
              const text = div.innerText || div.textContent || '';
              const className = div.className || '';
              
              if (text && text.trim()) {
                debugLog.push(`Found text: "${text}" with classes: "${className}"`);
                
                const phoneNum = extractPhoneFromText(text);
                if (phoneNum) {
                    return { phone: phoneNum, selector: selector, text: text, debugLog: debugLog };
                }
              }
            }
          } catch (e) {
            debugLog.push(`Error with selector ${selector}: ${e.message}`);
          }
        }
        
        // Coba cari semua elemen dengan class Io6YTe tanpa selector spesifik
        try {
          const allIo6Elements = detailPanel.querySelectorAll('[class*="Io6YTe"]');
          debugLog.push(`Found ${allIo6Elements.length} total elements with Io6YTe in class`);
          
          for (const el of allIo6Elements) {
            const text = el.innerText || el.textContent || '';
            if (text && text.trim()) {
              debugLog.push(`Checking element with text: "${text}" and classes: "${el.className}"`);
              
              const phoneNum = extractPhoneFromText(text);
              if (phoneNum) {
                  return { phone: phoneNum, selector: '[class*="Io6YTe"]', text: text, debugLog: debugLog };
              }
            }
          }
        } catch (e) {
          debugLog.push(`Error finding Io6YTe elements: ${e.message}`);
        }
        
        // Method 0.5: Cari semua DIV yang hanya berisi nomor telepon (seperti yang ditemukan di debug)
        try {
          const allDivs = detailPanel.querySelectorAll('div');
          debugLog.push(`Searching ${allDivs.length} divs for phone-like numbers`);
          
          for (const div of allDivs) {
            const text = (div.innerText || div.textContent || '').trim();
            // Cek jika text hanya berisi nomor (10-13 digits, mungkin dengan dash/spasi)
            if (text && /^[\d\s\-+()]{10,15}$/.test(text)) {
              const phoneNum = extractPhoneFromText(text);
              if (phoneNum) {
                // Pastikan tidak adalah bagian dari elemen yang lebih besar dengan banyak text
                const parentText = (div.parentElement?.innerText || '').trim();
                if (parentText.length < text.length * 3) { // Jika parent tidak terlalu besar
                  debugLog.push(`Found phone in div with only phone text: "${text}"`);
                  return { phone: phoneNum, selector: 'div (phone-only)', text: text, debugLog: debugLog };
                }
              }
            }
          }
        } catch (e) {
          debugLog.push(`Error searching all divs: ${e.message}`);
        }
        
        // Method 1: Cari button dengan data-item-id yang mengandung phone atau tel
        const phoneButtons = detailPanel.querySelectorAll('button[data-item-id*="phone"], button[data-item-id*="tel"], button[data-value*="phone"], button[data-value*="tel"]');
        for (const btn of phoneButtons) {
          const dataId = btn.getAttribute('data-item-id') || btn.getAttribute('data-value') || '';
          if (dataId) {
            const match = dataId.match(/tel:([^"]+)/i) || dataId.match(/phone:([^"]+)/i);
            if (match && match[1]) {
              const phoneNum = match[1].replace(/[^\d+()-]/g, '').trim();
              if (phoneNum.length >= 8) {
                return { phone: phoneNum, selector: 'button[data-item-id*="phone"]', text: dataId, debugLog: debugLog };
              }
            }
          }
        }
        
        // Method 2: Cari link tel:
        const telLinks = detailPanel.querySelectorAll('a[href^="tel:"], a[href*="tel:"]');
        for (const link of telLinks) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/tel:([^"]+)/i);
          if (match && match[1]) {
            const phoneNum = match[1].replace(/[^\d+()-]/g, '').trim();
            if (phoneNum.length >= 8) {
              return { phone: phoneNum, selector: 'a[href^="tel:"]', text: href, debugLog: debugLog };
            }
          }
        }
        
        // Method 3: Cari di aria-label yang mengandung phone
        const ariaElements = detailPanel.querySelectorAll('[aria-label*="phone"], [aria-label*="Phone"], [aria-label*="call"], [aria-label*="Call"]');
        for (const el of ariaElements) {
          const ariaLabel = el.getAttribute('aria-label') || '';
          // Extract phone dari aria-label
          const phoneMatch = ariaLabel.match(/(\+?\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9})/);
          if (phoneMatch) {
            const phoneNum = phoneMatch[1].replace(/\s+/g, '').replace(/[^\d+()-]/g, '').trim();
            if (phoneNum.length >= 8) {
              return { phone: phoneNum, selector: '[aria-label*="phone"]', text: ariaLabel, debugLog: debugLog };
            }
          }
        }
        
        // Method 4: Cari semua button dan cek text content atau data attributes
        const allButtons = detailPanel.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = btn.innerText || btn.textContent || '';
          const dataId = btn.getAttribute('data-item-id') || btn.getAttribute('data-value') || '';
          const combined = text + ' ' + dataId;
          
          const phoneNum = extractPhoneFromText(combined);
          if (phoneNum) {
            return { phone: phoneNum, selector: 'button', text: combined, debugLog: debugLog };
          }
        }
        
        // Method 5: Cari di seluruh detail panel dengan regex (sudah dalam panel, jadi langsung pakai)
        // Gunakan textContent untuk mendapatkan semua text termasuk yang hidden
        const text = detailPanel.textContent || detailPanel.innerText || '';
        debugLog.push(`Searching in panel text (length: ${text.length})`);
        
        // Cari semua kemungkinan nomor telepon di panel - PRIORITAS NOMOR HP (08xx)
        const phonePatterns = [
          // PRIORITY: Nomor HP (08xx) dengan berbagai format
          /\b(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})\b/g,  // 0812-3456-7890 atau 0812 3456 7890
          /\b(08\d{8,10})\b/g,  // 081234567890 (tanpa separator)
          /(\+?62[\s-]?8\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,  // +62 812-3456-7890
          // FALLBACK: Nomor telepon kantor dengan tanda kurung
          /(\(?0[2-7]\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/g,  // (021) 1234-5678
          // Format +62 (general)
            /(\+62[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
          // Format 0xx (general, tapi 08xx sudah di atas)
          /(0[2-7]\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
          // Format tanpa separator (10-13 digits) - prioritas 08xx
          /\b(08\d{8,10})\b/g,
          /\b(0[2-7]\d{8,10})\b/g,  // Telepon kantor (bukan 08)
          // Format 0711 atau area code lain (Palembang, dll)
          /\b(0711[\s-]?\d{3,4}[\s-]?\d{3,4})\b/g,
          // Format dengan tanda kurung (general)
          /(\(?\d{3,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,6})/g
        ];
        
        const allMatches = [];
        for (const pattern of phonePatterns) {
          const matches = text.match(pattern);
          if (matches) {
            allMatches.push(...matches);
          }
        }
        
        if (allMatches.length > 0) {
          debugLog.push(`Found ${allMatches.length} potential phone matches in text`);
          // Validasi dan ambil yang paling valid - PRIORITAS NOMOR HP (08xx)
          const validPhones = [];
          const hpPhones = []; // Khusus untuk nomor HP (08xx)
          
          for (const match of allMatches) {
            const phoneNum = extractPhoneFromText(match);
            if (phoneNum && phoneNum.length >= 10 && phoneNum.length <= 15) {
              // Hindari duplikat
              const phoneDigits = phoneNum.replace(/[^\d]/g, '');
              if (!validPhones.find(p => p.replace(/[^\d]/g, '') === phoneDigits)) {
                validPhones.push(phoneNum);
                // Pisahkan nomor HP (08xx) ke array terpisah
                if (phoneNum.startsWith('08')) {
                  hpPhones.push(phoneNum);
                }
                debugLog.push(`Valid phone found: ${phoneNum} from match: ${match}`);
              }
            }
          }
          
          if (validPhones.length > 0) {
            // PRIORITAS: Jika ada nomor HP (08xx), ambil yang paling panjang dari nomor HP
            if (hpPhones.length > 0) {
              const longestHp = hpPhones.reduce((a, b) => a.length > b.length ? a : b);
              debugLog.push(`Returning HP phone (08xx): ${longestHp} (prioritized over ${validPhones.length} total phones)`);
              return { phone: longestHp, selector: 'detailPanel (text search - HP priority)', text: longestHp, debugLog: debugLog };
            }
            // Jika tidak ada nomor HP, ambil yang paling panjang
            const longest = validPhones.reduce((a, b) => a.length > b.length ? a : b);
            debugLog.push(`Returning phone: ${longest} (no HP found)`);
            return { phone: longest, selector: 'detailPanel (text search)', text: longest, debugLog: debugLog };
          }
        }
        
        // Method 5.5: Cari di elemen yang ter-hidden atau di nested elements yang lebih dalam
        try {
          // Cari semua elemen yang mungkin mengandung nomor telepon, termasuk yang hidden
          const allElements = detailPanel.querySelectorAll('*');
          debugLog.push(`Searching in ${allElements.length} total elements (including hidden)`);
          
          for (const el of allElements) {
            // Skip jika element tidak memiliki text
            if (!el.textContent || el.textContent.trim().length < 8) continue;
            
            // Ambil text dari element ini saja (bukan children)
            const nodeText = Array.from(el.childNodes)
              .filter(node => node.nodeType === 3) // Text node
              .map(node => node.textContent)
              .join(' ')
              .trim();
            
            if (nodeText) {
              const phoneNum = extractPhoneFromText(nodeText);
              if (phoneNum && phoneNum.length >= 10 && phoneNum.length <= 15) {
                debugLog.push(`Found phone in element text: "${nodeText}" -> ${phoneNum}`);
                return { phone: phoneNum, selector: 'element text node', text: nodeText, debugLog: debugLog };
              }
            }
            
            // Juga cek innerText untuk elemen yang mungkin punya nested structure
            const innerText = (el.innerText || '').trim();
            if (innerText && innerText.length < 50) { // Hanya untuk text yang pendek (kemungkinan hanya nomor)
              const phoneNum = extractPhoneFromText(innerText);
              if (phoneNum && phoneNum.length >= 10 && phoneNum.length <= 15) {
                // Pastikan ini bukan bagian dari text yang lebih besar
                const parentText = (el.parentElement?.innerText || '').trim();
                if (parentText.length < innerText.length * 5) {
                  debugLog.push(`Found phone in element innerText: "${innerText}" -> ${phoneNum}`);
                  return { phone: phoneNum, selector: 'element innerText', text: innerText, debugLog: debugLog };
                }
              }
            }
          }
        } catch (e) {
          debugLog.push(`Error in Method 5.5: ${e.message}`);
        }
        
        // Method 6: Cari di semua span, div, p, dan elemen text lainnya dengan text yang pendek
        try {
          const textElements = detailPanel.querySelectorAll('span, div, p, li, td, th, label');
          debugLog.push(`Searching in ${textElements.length} text elements`);
          
          for (const el of textElements) {
            const text = (el.textContent || el.innerText || '').trim();
            
            // Fokus pada elemen dengan text pendek yang mungkin hanya berisi nomor
            if (text && text.length >= 8 && text.length <= 20 && /[\d\s\-+()]/.test(text)) {
              const phoneNum = extractPhoneFromText(text);
              if (phoneNum && phoneNum.length >= 10 && phoneNum.length <= 15) {
                // Skip jika elemen ini adalah bagian dari elemen yang lebih besar dengan banyak text
                const parentText = (el.parentElement?.textContent || '').trim();
                if (parentText.length < text.length * 10) {
                  debugLog.push(`Found phone in text element: "${text}" -> ${phoneNum}`);
                  return { phone: phoneNum, selector: 'text element', text: text, debugLog: debugLog };
                }
              }
            }
          }
        } catch (e) {
          debugLog.push(`Error in Method 6: ${e.message}`);
        }
        
        return { phone: null, debugLog: debugLog };
      }, businessName);
      
      // Extract phone dari result dan log debugging
      let phone = null;
      if (typeof phoneResult === 'string' && phoneResult) {
        // Jalur cepat dari tryFindPhoneWithScrolling
        return phoneResult;
      }

      if (phoneResult && phoneResult.debugLog) {
        console.log(`🔍 Debug log for ${businessName}:`);
        phoneResult.debugLog.forEach(log => console.log(`  ${log}`));
      }
      
      if (phoneResult && phoneResult.phone) {
        phone = phoneResult.phone;
        console.log(`✅ Found phone for ${businessName}: ${phone} (using selector: ${phoneResult.selector}, text: "${phoneResult.text}")`);
      } else {
        // Jika tidak ketemu di tab default, coba switch ke tab "About/Tentang" dan cari lagi
        console.log(`🔍 Phone not found in default tab, trying other tabs...`);
        try {
          const switchedTab = await page.evaluate(() => {
            const tabSelectors = [
              'button[role="tab"][aria-label*="Tentang"]',
              'button[role="tab"][aria-label*="About"]',
              'button[data-value="Tentang"]',
              'button[data-value="About"]',
              'button[role="tab"][aria-label*="Ringkasan"]',
              'button[role="tab"][aria-label*="Overview"]'
            ];
            for (const sel of tabSelectors) {
              const btn = document.querySelector(sel);
              if (btn && btn.getAttribute('aria-selected') !== 'true') {
                btn.click();
                return true;
              }
            }
            return false;
          });
          
          if (switchedTab) {
            console.log('🔁 Switched to another tab, searching again...');
            await new Promise(r => setTimeout(r, 2000));
            
            // Cari lagi setelah switch tab - scroll dulu untuk memastikan konten ter-load
            await page.evaluate(() => {
              const panel = document.querySelector('[role="main"], div[jsaction*="pane"], div.m6QErb');
              if (panel && panel.scrollHeight > panel.clientHeight) {
                const scrollSteps = 5;
                const scrollAmount = panel.scrollHeight / scrollSteps;
                for (let i = 0; i <= scrollSteps; i++) {
                  panel.scrollTop = scrollAmount * i;
                }
                panel.scrollTop = panel.scrollHeight;
              }
            });
            await new Promise(r => setTimeout(r, 1500));
            
            // Gunakan fungsi pencarian yang sama seperti di atas
            const retryPhoneResult = await page.evaluate((expectedBusinessName) => {
              // Helper function yang sama dengan improvements - PRIORITAS 08xx
              const extractPhoneFromText = (text) => {
                if (!text || !text.trim()) return null;
                const normalized = text.trim();
                
                // PRIORITY 1: Nomor HP (08xx) dengan dash/spasi
                const hpPattern08 = normalized.match(/\b(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})\b/);
                if (hpPattern08) {
                  const cleaned = hpPattern08[1].replace(/\s+/g, '').replace(/-/g, '').trim();
                  if (cleaned.length >= 10 && cleaned.length <= 13 && cleaned.startsWith('08')) {
                    return cleaned;
                  }
                }
                
                // PRIORITY 2: Nomor HP (08xx) tanpa separator
                const hpPattern08Long = normalized.match(/\b(08\d{8,10})\b/);
                if (hpPattern08Long) {
                  const num = hpPattern08Long[1];
                  if (num.length >= 10 && num.length <= 13) {
                    return num;
                  }
                }
                
                // PRIORITY 3: Nomor HP dengan +62
                const hpPattern62 = normalized.match(/(\+?62[\s-]?8\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/);
                if (hpPattern62) {
                  let cleaned = hpPattern62[1].replace(/\s+/g, '').replace(/-/g, '').trim();
                  if (cleaned.startsWith('+62') && cleaned.length >= 12) {
                    cleaned = '0' + cleaned.substring(3);
                  } else if (cleaned.startsWith('62') && cleaned.length >= 11 && !cleaned.startsWith('+62')) {
                    cleaned = '0' + cleaned.substring(2);
                  }
                  if (cleaned.length >= 10 && cleaned.length <= 13 && cleaned.startsWith('08')) {
                    return cleaned;
                  }
                }
                
                // PRIORITY 4: Semua nomor HP yang dimulai dengan 08 (catch-all)
                const allHpNumbers = normalized.match(/\b(08\d{8,10})\b/g);
                if (allHpNumbers && allHpNumbers.length > 0) {
                  const longestHp = allHpNumbers.reduce((a, b) => a.length > b.length ? a : b);
                  if (longestHp.length >= 10 && longestHp.length <= 13) {
                    return longestHp;
                  }
                }
                
                // FALLBACK 1: Nomor telepon kantor dengan tanda kurung
                const landlinePattern = normalized.match(/(\(?0[2-7]\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/);
                if (landlinePattern) {
                  let cleaned = landlinePattern[1].replace(/[()]/g, '').replace(/\s+/g, '').replace(/-/g, '').trim();
                  if (cleaned.length >= 9 && cleaned.length <= 12 && !cleaned.startsWith('08')) {
                    return cleaned;
                  }
                }
                
                // FALLBACK 2: Format tanpa dash (bukan 08)
                const noDashPattern = normalized.match(/\b(0[2-7]\d{8,10})\b/);
                if (noDashPattern) {
                  const num = noDashPattern[1];
                  if (!num.startsWith('08') && num.length >= 10 && num.length <= 12) {
                    return num;
                  }
                }
                
                // FALLBACK 3: Format +62 general
                const indonesiaPattern = normalized.match(/(\+?62[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/);
                if (indonesiaPattern) {
                  let cleaned = indonesiaPattern[1].replace(/\s+/g, '').replace(/-/g, '').trim();
                  if (cleaned.startsWith('+62') && cleaned.length >= 12) {
                    cleaned = '0' + cleaned.substring(3);
                  } else if (cleaned.startsWith('62') && cleaned.length >= 11 && !cleaned.startsWith('+62')) {
                    cleaned = '0' + cleaned.substring(2);
                  }
                  if (cleaned.length >= 10 && cleaned.length <= 15) {
                    // Prioritas ke 08
                    if (cleaned.startsWith('08')) return cleaned;
                    return cleaned;
                  }
                }
                
                // FALLBACK 4: Pattern dengan prefix
                const withPrefixPattern = normalized.match(/(?:tel|phone|hp|wa|whatsapp|mobile)[\s:]*([\d\s\-+()]{10,15})/i);
                if (withPrefixPattern && withPrefixPattern[1]) {
                  return extractPhoneFromText(withPrefixPattern[1]);
                }
                
                return null;
              };
              
              // Find detail panel dengan logika yang sama
              const allPanels = document.querySelectorAll('[role="main"], div[jsaction*="pane"], div.m6QErb, div[role="region"]');
              let detailPanel = null;
              
              for (const panel of allPanels) {
                const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
                if (hasSearchFeed) continue;
                
                const hasTitle = panel.querySelector('h1.DUwDvf') !== null;
                const hasTabs = panel.querySelectorAll('button[role="tab"]').length > 0;
                const hasDetailElements = panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe').length > 0;
                
                if ((hasTitle || hasTabs) && hasDetailElements) {
                  detailPanel = panel;
                  break;
                }
              }
              
              if (!detailPanel) {
                for (const panel of allPanels) {
                  const hasSearchFeed = panel.querySelector('div[role="feed"]') !== null;
                  if (!hasSearchFeed && panel.querySelectorAll('[class*="Io6YTe"], button.CsEnBe, h1.DUwDvf').length > 0) {
                    detailPanel = panel;
                    break;
                  }
                }
              }
              
              if (!detailPanel) return { phone: null };
              
              // Cari nomor telepon dengan metode yang sama
              // 1. Tombol phone
              const phoneButton = detailPanel.querySelector('button.CsEnBe[data-item-id^="phone:tel:"]');
              if (phoneButton) {
                const dataId = phoneButton.getAttribute('data-item-id') || '';
                const match = dataId.match(/phone:tel:(\+?\d+)/i);
                if (match && match[1]) return { phone: match[1].trim() };
              }
              
              // 2. Io6YTe elements
              const io6Elements = detailPanel.querySelectorAll('[class*="Io6YTe"]');
              for (const el of io6Elements) {
                const text = (el.innerText || el.textContent || '').trim();
                const phoneNum = extractPhoneFromText(text);
                if (phoneNum && phoneNum.length >= 10) return { phone: phoneNum };
              }
              
              // 3. Semua text di panel
              const text = detailPanel.textContent || detailPanel.innerText || '';
              // PRIORITAS NOMOR HP (08xx)
              const phonePatterns = [
                // PRIORITY: Nomor HP (08xx)
                /\b(08\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})\b/g,
                /\b(08\d{8,10})\b/g,
                /(\+?62[\s-]?8\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
                // FALLBACK: Nomor telepon kantor
                /(\(?0[2-7]\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
                /(\+62[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
                /(0[2-7]\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
                /\b(0[2-7]\d{8,10})\b/g,
                /\b(0711[\s-]?\d{3,4}[\s-]?\d{3,4})\b/g
              ];
              
              const allMatches = [];
              for (const pattern of phonePatterns) {
                const matches = text.match(pattern);
                if (matches) allMatches.push(...matches);
              }
              
              const validPhones = [];
              const hpPhones = []; // Khusus untuk nomor HP (08xx)
              
              for (const match of allMatches) {
                const phoneNum = extractPhoneFromText(match);
                if (phoneNum && phoneNum.length >= 10 && phoneNum.length <= 15) {
                  const phoneDigits = phoneNum.replace(/[^\d]/g, '');
                  if (!validPhones.find(p => p.replace(/[^\d]/g, '') === phoneDigits)) {
                    validPhones.push(phoneNum);
                    // Pisahkan nomor HP (08xx)
                    if (phoneNum.startsWith('08')) {
                      hpPhones.push(phoneNum);
                    }
                  }
                }
              }
              
              if (validPhones.length > 0) {
                // PRIORITAS: Jika ada nomor HP (08xx), ambil yang paling panjang
                if (hpPhones.length > 0) {
                  return { phone: hpPhones.reduce((a, b) => a.length > b.length ? a : b) };
                }
                // Jika tidak ada nomor HP, ambil yang paling panjang
                return { phone: validPhones.reduce((a, b) => a.length > b.length ? a : b) };
              }
              
              return { phone: null };
            }, businessName);
            
            if (retryPhoneResult && retryPhoneResult.phone) {
              phone = retryPhoneResult.phone;
              console.log(`✅ Found phone for ${businessName} after tab switch: ${phone}`);
            }
          }
        } catch (e) {
          console.log(`Tab switch retry error: ${e.message}`);
        }
        
        // Jika masih belum ketemu setelah switch tab, masuk ke debug mode
        if (!phone) {
        // Debug: Jika tidak ada phone, log lebih detail
          const debugInfo = await page.evaluate((expectedBusinessName) => {
            // Cari detail panel yang benar (sama seperti di atas)
            const findDetailPanel = () => {
              const panelSelectors = [
                'div.m6QErb.XiKgde[role="region"]',
                'div[jsaction*="pane"].m6QErb',
                'div[role="main"].m6QErb',
                'div.m6QErb[role="region"]',
                '[role="main"]',
                'div[jsaction*="pane"]'
              ];
              
              for (const selector of panelSelectors) {
                const panels = document.querySelectorAll(selector);
                for (const panel of panels) {
                  const hasSearchResults = panel.querySelectorAll('div[role="feed"]').length > 0;
                  const hasDetailContent = panel.querySelectorAll('h1.DUwDvf, button[role="tab"]').length > 0;
                  
                  if (hasDetailContent && !hasSearchResults) {
                    const title = panel.querySelector('h1.DUwDvf');
                    if (title) {
                      const titleText = (title.innerText || title.textContent || '').trim().toLowerCase();
                      const expected = (expectedBusinessName || '').toLowerCase();
                      if (!expected || titleText.includes(expected.substring(0, Math.min(10, expected.length))) || expected.includes(titleText.substring(0, Math.min(10, titleText.length)))) {
                        return panel;
                      }
                    } else {
                      return panel;
                    }
                  }
                }
              }
              
              const panelWithTabs = Array.from(document.querySelectorAll('[role="main"], div[jsaction*="pane"]')).find(p => {
                return p.querySelectorAll('button[role="tab"]').length > 0;
              });
              if (panelWithTabs) return panelWithTabs;
              
              return null;
            };
            
            const detailPanel = findDetailPanel();
            const fallbackPanel = document.querySelector('[role="main"]') || document.querySelector('div[jsaction*="pane"]');
            const panel = detailPanel || fallbackPanel;
            
            if (!panel) {
              return {
                panelExists: false,
                detailPanelFound: false,
                io6Count: 0,
                io6Details: [],
                fontBodyCount: 0,
                fontBodyDetails: [],
                phoneLikeDivs: [],
                allText: 'No panel found'
              };
            }
            
            // Cari semua elemen dengan class Io6YTe dalam detailPanel
            const io6Elements = panel.querySelectorAll('[class*="Io6YTe"]');
          const io6Details = Array.from(io6Elements).slice(0, 20).map(el => ({
            text: (el.innerText || el.textContent || '').trim(),
            className: el.className || '',
            tagName: el.tagName
          }));
          
            // Cari semua elemen dengan fontBodyMedium dalam detailPanel
            const fontBodyElements = panel.querySelectorAll('[class*="fontBodyMedium"]');
          const fontBodyDetails = Array.from(fontBodyElements).slice(0, 20).map(el => ({
            text: (el.innerText || el.textContent || '').trim(),
            className: el.className || '',
            tagName: el.tagName
          }));
          
            // Cari semua div yang mungkin mengandung nomor telepon dalam detailPanel
            const allDivs = panel.querySelectorAll('div');
          const phoneLikeDivs = Array.from(allDivs).filter(div => {
            const text = (div.innerText || div.textContent || '').trim();
            return /^\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,6}$/.test(text);
          }).slice(0, 10).map(el => ({
            text: (el.innerText || el.textContent || '').trim(),
            className: el.className || '',
            tagName: el.tagName
          }));
          
          return {
            panelExists: !!panel,
              detailPanelFound: !!detailPanel,
            io6Count: io6Elements.length,
            io6Details: io6Details,
            fontBodyCount: fontBodyElements.length,
            fontBodyDetails: fontBodyDetails.slice(0, 10),
            phoneLikeDivs: phoneLikeDivs,
            allText: panel ? (panel.innerText || panel.textContent || '').substring(0, 2000) : 'No panel'
          };
          }, businessName);
        
        console.log(`🔍 Debug info for ${businessName}:`, JSON.stringify(debugInfo, null, 2));
        }
      }

      // Kembali ke list view dengan klik di area kosong atau ESC
      try {
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        // Ignore error
      }

      return phone;
    } catch (err) {
      console.error(`Error in getPhoneNumber for ${businessName}:`, err.message);
      return null;
    }
  }

  async scrapeMultipleKeywords(keywords) {
    const allResults = [];
    
    for (const keyword of keywords) {
      try {
        const results = await this.scrapeGoogleMaps(keyword);
        allResults.push({
          keyword,
          results,
          count: results.length
        });
      } catch (error) {
        allResults.push({
          keyword,
          results: [],
          count: 0,
          error: error.message
        });
      }
      
      // Delay antar keyword untuk avoid detection
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return allResults;
  }

  async scrapeGoogleMapsWithSession(sessionId) {
    let session = await sessionService.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!Array.isArray(session.keywords) || session.keywords.length === 0) {
      await sessionService.completeSession(sessionId);
      return session.results || [];
    }

    if (session.status === 'completed') {
      console.log(`✅ Session ${sessionId} sudah selesai sebelumnya.`);
      return session.results || [];
    }

    if (session.status === 'stopped') {
      session = await sessionService.resumeSession(sessionId);
    }

    let browser;

    try {
      console.log(`🔍 Mulai scraping session ${sessionId} dengan ${session.totalKeywords} keyword.`);

      const launchOptions = this.buildLaunchOptions(session.options || {});
      browser = await puppeteer.launch(launchOptions);
      this.activeBrowsers.set(sessionId, browser);

      const page = await browser.newPage();
      await page.setUserAgent(DEFAULT_USER_AGENT);
      await page.setViewport({ width: 1920, height: 1080 });

      let processing = true;

      while (processing) {
        const currentSession = sessionService.getSession(sessionId);
        if (!currentSession || currentSession.status !== 'running') {
          console.log(`⏸️ Session ${sessionId} dihentikan sementara.`);
          break;
        }

        const keywordIndex = currentSession.currentKeywordIndex || 0;
        if (keywordIndex >= currentSession.totalKeywords) {
          console.log(`✅ Semua keyword pada session ${sessionId} telah diproses.`);
          await sessionService.completeSession(sessionId);
          break;
        }

        const keyword = currentSession.keywords[keywordIndex];
        await this.processKeywordWithSession(browser, page, sessionId, keyword, keywordIndex);
      }

      const finalSession = sessionService.getSession(sessionId);
      if (finalSession && finalSession.status === 'running' && finalSession.currentKeywordIndex >= finalSession.totalKeywords) {
        await sessionService.completeSession(sessionId);
      }

      await browser.close();
      this.activeBrowsers.delete(sessionId);

      return sessionService.getSession(sessionId)?.results || [];
    } catch (error) {
      console.error('❌ Scraping error:', error.message);

      const sessionSnapshot = sessionService.getSession(sessionId);
      if (sessionSnapshot) {
        const errors = Array.isArray(sessionSnapshot.errors) ? sessionSnapshot.errors : [];
        errors.push({
          error: error.message,
          timestamp: new Date().toISOString(),
        });

        await sessionService.updateSession(sessionId, {
          status: 'stopped',
          errors,
        });
      }

      if (browser) {
        await browser.close();
        this.activeBrowsers.delete(sessionId);
      }

      throw error;
    }
  }

  async processKeywordWithSession(browser, page, sessionId, keyword, keywordIndex) {
    const session = sessionService.getSession(sessionId);
    if (!session) return;

    const location = session.location || '';
    const searchQuery = location ? `${keyword} ${location}` : keyword;
    const encodedQuery = encodeURIComponent(searchQuery);
    const url = `https://www.google.com/maps/search/${encodedQuery}`;

    const existingResults = (session.results || []).filter(result => result.keyword === keyword);
    const otherResults = (session.results || []).filter(result => result.keyword !== keyword);
    const startFromIndex = existingResults.length;

    await sessionService.updateSession(sessionId, {
      currentKeywordIndex: keywordIndex,
      currentKeyword: keyword,
      currentIndex: startFromIndex,
      totalFound: existingResults.length,
      phase: 'scrolling',
      scrollCount: 0,
    });

    await sessionService.updateKeywordSummary(sessionId, keyword, {
      status: 'running',
      processed: startFromIndex,
      totalFound: existingResults.length,
    });

    console.log(`\n🔍 [${keywordIndex + 1}/${session.totalKeywords}] Keyword: ${keyword}`);
    console.log(`📍 Opening: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // Try to wait for selector with initial timeout
      let feedElement = null;
      try {
        await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
        feedElement = await page.$('div[role="feed"]');
      } catch (firstError) {
        console.log(`⏳ Selector tidak ditemukan, menunggu lebih lama...`);
        // Wait a bit longer and retry
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
          feedElement = await page.$('div[role="feed"]');
        } catch (secondError) {
          console.log(`⏳ Masih belum ditemukan, menunggu sekali lagi...`);
          // Final wait and retry
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          try {
            await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
            feedElement = await page.$('div[role="feed"]');
          } catch (finalError) {
            console.log(`❌ Selector 'div[role="feed"]' tidak ditemukan setelah beberapa kali retry`);
            console.log(`⏭️ Skip keyword "${keyword}" dan lanjut ke keyword berikutnya`);
            
            // Update session to mark this keyword as skipped
            await sessionService.updateKeywordSummary(sessionId, keyword, {
              status: 'skipped',
              processed: 0,
              totalFound: 0,
              error: 'Selector div[role="feed"] tidak ditemukan'
            });
            
            await sessionService.updateSession(sessionId, {
              currentKeywordIndex: keywordIndex + 1,
              currentKeyword: session.keywords[keywordIndex + 1] || null,
            });
            
            return; // Skip this keyword and continue to next
          }
        }
      }

      if (!feedElement) {
        console.log(`❌ Selector 'div[role="feed"]' tidak ditemukan`);
        console.log(`⏭️ Skip keyword "${keyword}" dan lanjut ke keyword berikutnya`);
        
        await sessionService.updateKeywordSummary(sessionId, keyword, {
          status: 'skipped',
          processed: 0,
          totalFound: 0,
          error: 'Selector div[role="feed"] tidak ditemukan'
        });
        
        await sessionService.updateSession(sessionId, {
          currentKeywordIndex: keywordIndex + 1,
          currentKeyword: session.keywords[keywordIndex + 1] || null,
        });
        
        return; // Skip this keyword and continue to next
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Try to scroll, but handle errors gracefully
      try {
        await this.scrollResultsWithSession(page, session.maxResults, sessionId);
      } catch (scrollError) {
        console.log(`⚠️ Error saat scrolling: ${scrollError.message}`);
        console.log(`⏭️ Skip keyword "${keyword}" dan lanjut ke keyword berikutnya`);
        
        await sessionService.updateKeywordSummary(sessionId, keyword, {
          status: 'skipped',
          processed: 0,
          totalFound: 0,
          error: `Error saat scrolling: ${scrollError.message}`
        });
        
        await sessionService.updateSession(sessionId, {
          currentKeywordIndex: keywordIndex + 1,
          currentKeyword: session.keywords[keywordIndex + 1] || null,
        });
        
        return; // Skip this keyword and continue to next
      }
    } catch (error) {
      console.log(`❌ Error saat memproses keyword "${keyword}": ${error.message}`);
      console.log(`⏭️ Skip keyword "${keyword}" dan lanjut ke keyword berikutnya`);
      
      await sessionService.updateKeywordSummary(sessionId, keyword, {
        status: 'skipped',
        processed: 0,
        totalFound: 0,
        error: error.message
      });
      
      await sessionService.updateSession(sessionId, {
        currentKeywordIndex: keywordIndex + 1,
        currentKeyword: session.keywords[keywordIndex + 1] || null,
      });
      
      return; // Skip this keyword and continue to next
    }

    const businesses = await page.evaluate((maxResults, keywordLabel) => {
      const results = [];

      const selectors = [
        'div[role="feed"] > div > div[jsaction]',
        'div[role="feed"] > div[jsaction]',
        'div[role="feed"] div[jsaction].m6QErb',
      ];

      let items = [];
      for (const selector of selectors) {
        const found = document.querySelectorAll(selector);
        if (found.length > items.length) {
          items = Array.from(found);
        }
      }

      if (items.length === 0) {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          items = Array.from(feed.querySelectorAll('div[jsaction]'));
        }
      }

      const seenNames = new Set();

      items.forEach(item => {
        try {
          const nameElement = item.querySelector('div.fontHeadlineSmall') ||
            item.querySelector('[class*="fontHeadline"]') ||
            item.querySelector('div[aria-label]');
          const name = nameElement ? (nameElement.innerText || nameElement.getAttribute('aria-label') || '').trim() : '';

          if (!name || seenNames.has(name)) return;
          seenNames.add(name);

          // Rating dan reviews - cari di berbagai tempat
          let rating = '';
          
          // Method 1: Cari dari aria-label
          const ratingElement = item.querySelector('[aria-label*="stars"]') ||
            item.querySelector('[aria-label*="Star"]') ||
            item.querySelector('span[role="img"]');
          if (ratingElement) {
            const ariaLabel = ratingElement.getAttribute('aria-label') || '';
            const ratingMatch = ariaLabel.match(/(\d+[.,]?\d*)/);
            if (ratingMatch) {
              rating = ratingMatch[1].replace(',', '.');
            }
          }
          
          // Method 2: Cari format rating seperti "4,6(67)" atau "4.6(67)" di teks
          if (!rating) {
            const allText = item.innerText || item.textContent || '';
            // Pattern untuk rating: angka, koma/titik, angka, kurung buka, angka, kurung tutup
            const ratingPatterns = [
              /(\d+[,.]\d+)\s*\((\d+)\)/,  // Format: 4,6(67) atau 4.6(67)
              /(\d+[,.]\d+)\s+stars?/i,     // Format: 4.6 stars
              /rating[:\s]+(\d+[,.]\d*)/i,  // Format: rating: 4.6
              /(\d+[,.]\d*)\s*\/\s*5/i     // Format: 4.6/5
            ];
            
            for (const pattern of ratingPatterns) {
              const match = allText.match(pattern);
              if (match && match[1]) {
                rating = match[1].replace(',', '.');
                break;
              }
            }
          }
          
          // Method 3: Cari di elemen yang mengandung rating
          if (!rating) {
            const ratingSelectors = [
              'span[aria-label*="star"]',
              'span[aria-label*="Star"]',
              'span[aria-label*="rating"]',
              'span[aria-label*="Rating"]',
              'div[class*="fontBodyMedium"] span'
            ];
            
            for (const selector of ratingSelectors) {
              const elements = item.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.innerText || el.getAttribute('aria-label') || '';
                // Cek format rating
                const ratingMatch = text.match(/(\d+[,.]\d+)\s*\((\d+)\)/);
                if (ratingMatch && ratingMatch[1]) {
                  rating = ratingMatch[1].replace(',', '.');
                  break;
                }
              }
              if (rating) break;
            }
          }
          
          // Convert to number format, default to 'N/A' if not found
          const ratingValue = rating ? rating : 'N/A';

          // Kategori - cari dari berbagai sumber
          let category = 'N/A';
          
          // Prioritas 1: Cari button dengan jsaction yang mengandung "category" di dalam div.fontBodyMedium
          const categoryButton = item.querySelector('div.fontBodyMedium button[jsaction*="category"]') ||
                                item.querySelector('div[class*="fontBodyMedium"] button[jsaction*="category"]') ||
                                item.querySelector('button.DkEaL[jsaction*="category"]') ||
                                item.querySelector('button[class*="DkEaL"][jsaction*="category"]') ||
                                item.querySelector('button[jsaction*="category"]');
          
          if (categoryButton) {
            category = categoryButton.innerText.trim();
          }
          
          // Prioritas 2: Cari teks yang mengandung kata kategori umum (Produsen, Pabrik, dll)
          if (category === 'N/A') {
            const allText = item.innerText || item.textContent || '';
            
            // Pattern untuk kategori umum
            const categoryKeywords = [
              /(Produsen|Pabrik|Factory|Manufacturer|Manufacturing)/i,
              /(Pabrik\s+[A-Za-z]+)/i,  // Pabrik Kapas, Pabrik tekstil, dll
              /(Kantor\s+Perusahaan|Office|Corporate)/i,
              /(Distributor|Supplier|Vendor)/i,
              /(Toko|Store|Shop|Retail)/i,
              /(Restoran|Restaurant|Cafe|Café)/i,
              /(Hotel|Penginapan|Lodging)/i,
              /(Bengkel|Workshop|Service)/i,
              /(Salon|Beauty|Kecantikan)/i,
              /(Klinik|Clinic|Puskesmas)/i,
              /(Sekolah|School|Education)/i
            ];
            
            for (const pattern of categoryKeywords) {
              const match = allText.match(pattern);
              if (match && match[1]) {
                // Pastikan bukan bagian dari alamat atau nama
                const matchText = match[1].trim();
                const matchIndex = allText.indexOf(matchText);
                
                // Cek apakah ini bukan bagian dari nama bisnis (biasanya di awal)
                const nameIndex = allText.indexOf(name);
                if (matchIndex > nameIndex + name.length + 10) { // Setidaknya 10 karakter setelah nama
                  category = matchText;
                  break;
                }
              }
            }
          }
          
          // Prioritas 3: Cari di struktur HTML spesifik - hanya button kategori, bukan teks lain
          if (category === 'N/A') {
            // Cari semua button di dalam div.fontBodyMedium
            const allButtons = item.querySelectorAll('div.fontBodyMedium button, div[class*="fontBodyMedium"] button');
            for (const btn of allButtons) {
              const btnText = btn.innerText.trim();
              if (!btnText) continue;
              
              // Skip jika ini review count atau rating
              const isReviewCount = /^\(\d+\)$/.test(btnText);
              const isOnlyNumber = /^\d+[,.]?\d*$/.test(btnText);
              const isRating = /★|stars?|rating|review/i.test(btnText) ||
                              /^\d+[,.]\d+\s*\(\d+\)/.test(btnText) ||
                              /^\d+[,.]\d+\s*stars?/i.test(btnText) ||
                              isOnlyNumber ||
                              isReviewCount;
              
              if (!isRating && btnText.length > 0 && btnText.length < 100) {
                category = btnText;
                break;
              }
            }
          }
          
          // Prioritas 4: Fallback - cari di struktur HTML spesifik (jika button tidak ditemukan)
          if (category === 'N/A') {
            const categorySelectors = [
              'div.fontBodyMedium > div > div:nth-child(1) span',
              'div.fontBodyMedium > div > div:first-child span',
              'div[class*="fontBodyMedium"] > div > div:first-child span'
            ];
            
            for (const selector of categorySelectors) {
              const elements = item.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.innerText.trim();
                if (!text) continue;
                
                // Skip jika ini hanya angka atau rating (lebih ketat)
                const isOnlyNumber = /^\d+[,.]?\d*$/.test(text); // Hanya angka seperti "4,6"
                const isReviewCount = /^\(\d+\)$/.test(text); // Format: (5), (59), (170) - review count
                const isRating = /★|stars?|rating|review/i.test(text) ||
                                /^\d+[,.]\d+\s*\(\d+\)/.test(text) || // Format: 4,6(67)
                                /^\d+[,.]\d+\s*stars?/i.test(text) || // Format: 4.6 stars
                                /^\d+[,.]\d+\s*\/\s*5/.test(text) || // Format: 4.6/5
                                isOnlyNumber || // Hanya angka saja
                                isReviewCount; // Review count dalam kurung
                
                // Skip jika ini jam buka
                const isHours = /^(buka|tutup|closed|open|24\s*jam|jam|hours)/i.test(text) ||
                                /\d{1,2}:\d{2}/.test(text) ||
                                /^\d{1,2}\s*(am|pm|AM|PM)/i.test(text) ||
                                text.toLowerCase().includes('buka') ||
                                text.toLowerCase().includes('tutup') ||
                                text.toLowerCase().includes('closed') ||
                                text.toLowerCase().includes('open');
                
                // Skip jika ini jarak
                const isDistance = /^\d+\.?\d*\s*(km|m|meter|kilometer)/i.test(text);
                
                // Skip jika ini alamat
                const isAddress = text.length > 50 || 
                                 /jalan|street|jl\.|jln|alamat|address/i.test(text);
                
                // Skip jika ini nama bisnis
                const isName = text === name || text.includes(name);
                
                if (!isHours && !isRating && !isDistance && !isAddress && !isName && 
                    text.length > 0 && text.length < 100 && 
                    !/^\d+[,.]?\d*$/.test(text) && // Pastikan bukan hanya angka
                    !/^\(\d+\)$/.test(text)) { // Pastikan bukan review count seperti (5), (59)
                  category = text;
                  break;
                }
              }
              if (category !== 'N/A') break;
            }
          }

          const addressElement = item.querySelector('div[class*="fontBodyMedium"]') ||
            item.querySelector('[aria-label]');
          const address = addressElement ? (addressElement.innerText || addressElement.getAttribute('aria-label') || '').trim() : '';

          // CRITICAL: Extract link dari item yang SAMA dengan business name
          // Prioritas: cari link di dalam item yang sama dengan name element
          let linkElement = null;
          
          // Strategy 1: Cari link di dalam item yang sama
          linkElement = item.querySelector('a.hfpxzc');
          
          // Strategy 2: Jika tidak ada, cari link di parent container yang sama dengan name
          if (!linkElement && nameElement) {
            const parentContainer = nameElement.closest('div[jsaction]');
            if (parentContainer) {
              linkElement = parentContainer.querySelector('a.hfpxzc');
            }
          }
          
          // Strategy 3: Fallback - cari link terdekat di item
          if (!linkElement) {
            // Cari semua link di item dan ambil yang pertama
            const allLinks = item.querySelectorAll('a[href*="/maps/place/"]');
            if (allLinks.length > 0) {
              linkElement = allLinks[0];
            }
          }
          
          let detailUrl = '';
          if (linkElement) {
            detailUrl = linkElement.href || linkElement.getAttribute('href') || '';
            if (detailUrl && detailUrl.startsWith('/')) {
              detailUrl = `https://www.google.com${detailUrl}`;
            }
          } else {
            console.warn(`⚠️ No link found for business "${name}" - will skip phone extraction`);
          }
          
          // VALIDASI: Pastikan detailUrl sesuai dengan business name (basic check)
          if (detailUrl && name) {
            const urlBusinessName = detailUrl.match(/place\/([^/]+)/)?.[1]?.replace(/\+/g, ' ') || '';
            const expectedName = name.toLowerCase().trim();
            const urlName = decodeURIComponent(urlBusinessName).toLowerCase().trim();
            
            const nameWords = expectedName.split(/\s+/).filter(w => w.length > 2);
            const matchingWords = nameWords.filter(w => urlName.includes(w));
            const matchRatio = nameWords.length > 0 ? matchingWords.length / nameWords.length : 0;
            
            if (matchRatio < 0.2 && urlBusinessName) {
              console.warn(`⚠️ DetailUrl mungkin tidak sesuai untuk "${name}"`);
              console.warn(`   URL contains: "${urlBusinessName}"`);
              console.warn(`   Only ${matchingWords.length}/${nameWords.length} words match`);
              // Tetap gunakan detailUrl, tapi akan divalidasi lagi saat scrape
            }
          }

          results.push({
            keyword: keywordLabel,
            name: name || 'N/A',
            rating: ratingValue || 'N/A',
            category: category || 'N/A',
            address: address || 'N/A',
            phone: 'N/A',
            detailUrl: detailUrl || '',
          });
        } catch (err) {
          console.error('Error parsing item:', err.message);
        }
      });

      return results;
    }, session.maxResults, keyword);

    console.log(`✅ Found ${businesses.length} businesses untuk keyword "${keyword}"`);

    await sessionService.updateSession(sessionId, {
      totalFound: businesses.length,
    });
    await sessionService.updateKeywordSummary(sessionId, keyword, {
      totalFound: businesses.length,
    });

    let businessesToProcess = businesses.map(business => ({
      ...business,
      keyword,
    }));

    // VALIDASI: Cek duplicate detailUrl dan handle dengan benar
    const detailUrlMap = new Map();
    const duplicateDetailUrlBusinesses = [];
    
    businessesToProcess.forEach((business, idx) => {
      if (business.detailUrl && business.detailUrl !== '') {
        if (detailUrlMap.has(business.detailUrl)) {
          const existingBusiness = detailUrlMap.get(business.detailUrl);
          console.warn(`⚠️ DUPLICATE detailUrl detected!`);
          console.warn(`   Business 1: "${existingBusiness.name}" [Index: ${existingBusiness.index}]`);
          console.warn(`   Business 2: "${business.name}" [Index: ${idx}]`);
          console.warn(`   DetailUrl: ${business.detailUrl.substring(0, 80)}...`);
          
          // Mark business dengan duplicate detailUrl
          duplicateDetailUrlBusinesses.push(idx);
          
          // Jika bisnis berbeda tapi detailUrl sama, kemungkinan:
          // 1. Cabang yang sama (expected)
          // 2. DetailUrl salah di-extract (problem!)
          // Untuk safety, kita akan skip phone extraction untuk bisnis kedua
          console.warn(`   ⚠️ Skipping phone extraction for "${business.name}" to avoid duplicate phone numbers`);
        } else {
          detailUrlMap.set(business.detailUrl, { name: business.name, index: idx });
        }
      }
    });
    
    if (duplicateDetailUrlBusinesses.length > 0) {
      console.warn(`\n⚠️ Total ${duplicateDetailUrlBusinesses.length} businesses with duplicate detailUrl will skip phone extraction\n`);
    }

    if (existingResults.length > 0) {
      const existingMap = new Map(existingResults.map(result => [result.name, result]));

      businessesToProcess = businessesToProcess.map((business, idx) => {
        const existing = existingMap.get(business.name);
        if (existing) {
          // PRIORITAS: Gunakan detailUrl dari business yang baru di-extract (lebih fresh & accurate)
          // Hanya gunakan existing.detailUrl jika business.detailUrl kosong
          const finalDetailUrl = business.detailUrl || existing.detailUrl || '';
          
          return {
            ...business,
            ...existing,
            keyword,
            detailUrl: finalDetailUrl,  // Prioritaskan detailUrl yang baru
            phone: existing.phone || business.phone || 'N/A',
          };
        }
        return {
          ...business,
          phone: business.phone || 'N/A',
        };
      });

      existingResults.forEach(existing => {
        if (!businessesToProcess.some(business => business.name === existing.name)) {
          businessesToProcess.push({
            ...existing,
            keyword,
            phone: existing.phone || 'N/A',
          });
        }
      });
    }

    // WORKER POOL: Proses 5 bisnis sekaligus dengan 5 tab PARALEL (setiap worker punya page sendiri)
    const NUM_WORKERS = 5;
    
    // CRITICAL: Create map untuk track business by name untuk ensure detailUrl benar
    const businessNameMap = new Map();
    businessesToProcess.forEach((business, idx) => {
      businessNameMap.set(business.name, { business, index: idx });
    });
    
    // Deep clone setiap business untuk avoid reference sharing
    // Pastikan setiap business di queue punya detailUrl yang benar sesuai dengan name
    const businessQueue = businessesToProcess.slice(startFromIndex).map((business, idx) => {
      const actualIndex = startFromIndex + idx;
      const actualBusiness = businessesToProcess[actualIndex];
      
      // VALIDASI: Pastikan business name dan detailUrl sesuai
      if (actualBusiness.name !== business.name) {
        console.error(`❌ Business name mismatch at index ${actualIndex}! Queue: "${business.name}", Array: "${actualBusiness.name}"`);
      }
      
      return {
        business: JSON.parse(JSON.stringify(actualBusiness)), // Deep clone dari array, bukan dari slice
        index: actualIndex,
        businessName: actualBusiness.name // Store name untuk verification
      };
    });
    
    let processedCount = startFromIndex;
    const totalToProcess = businessesToProcess.length;
    
    console.log(`\n⚡⚡⚡ WORKER POOL MODE: ${NUM_WORKERS} workers, ${businessQueue.length} bisnis untuk diproses\n`);

    // Worker function - setiap worker independen dengan page sendiri
    const workerProcessor = async (workerId) => {
      const workerPage = await browser.newPage();
      await workerPage.setUserAgent(DEFAULT_USER_AGENT);
      await workerPage.setViewport({ width: 1920, height: 1080 });
      
      try {
        while (businessQueue.length > 0) {
          // Check session status
          const currentSession = sessionService.getSession(sessionId);
          if (!currentSession || currentSession.status !== 'running') {
            console.log(`⏸️ [WORKER ${workerId}] Session dihentikan`);
            break;
          }

          // Ambil 1 bisnis dari queue (atomic operation - shift() is thread-safe in JS single-threaded model)
          const item = businessQueue.shift();
          if (!item) break;

          const { business, index, businessName } = item;
          
          // VALIDASI: Pastikan index sesuai dengan business di array
          if (index < 0 || index >= businessesToProcess.length) {
            console.error(`❌ [WORKER ${workerId}] Invalid index ${index} for ${businessName}! Skipping...`);
            processedCount++;
            continue;
          }
          
          // CRITICAL: Ambil business dari array berdasarkan INDEX (bukan dari queue!)
          // Ini memastikan kita menggunakan data yang paling up-to-date
          const originalBusiness = businessesToProcess[index];
          
          // VALIDASI: Pastikan business name sesuai
          if (originalBusiness.name !== businessName) {
            console.error(`❌ [WORKER ${workerId}] Business name mismatch! Expected: "${businessName}", Array: "${originalBusiness.name}" [Index: ${index}]`);
            console.error(`   Using business from array: "${originalBusiness.name}"`);
          }
          
          // CRITICAL: Gunakan business dari array (bukan dari queue!) untuk memastikan detailUrl benar
          const businessClone = {
            ...originalBusiness,  // SELALU gunakan dari array!
            phone: originalBusiness.phone || 'N/A',
          };
          
          // VALIDASI FINAL: Pastikan detailUrl sesuai dengan business name
          // Set flag untuk skip phone extraction jika detailUrl tidak sesuai
          let shouldSkipPhoneExtraction = false;
          
          if (businessClone.detailUrl && businessClone.name) {
            const urlBusinessName = businessClone.detailUrl.match(/place\/([^/]+)/)?.[1]?.replace(/\+/g, ' ') || '';
            const expectedName = businessClone.name.toLowerCase().trim();
            const urlName = decodeURIComponent(urlBusinessName).toLowerCase().trim();
            
            const nameWords = expectedName.split(/\s+/).filter(w => w.length > 2);
            const matchingWords = nameWords.filter(w => urlName.includes(w));
            const matchRatio = nameWords.length > 0 ? matchingWords.length / nameWords.length : 0;
            
            // Validasi ketat: minimal 40% match untuk memastikan detailUrl benar-benar sesuai
            // Skip jika match ratio terlalu rendah untuk avoid wrong phone number
            if (matchRatio < 0.4 && urlBusinessName && nameWords.length > 1) {
              console.error(`❌ [WORKER ${workerId}] DetailUrl TIDAK SESUAI untuk "${businessClone.name}" [Index: ${index}]!`);
              console.error(`   Expected: "${businessClone.name}"`);
              console.error(`   URL contains: "${urlBusinessName}"`);
              console.error(`   Match: ${matchingWords.length}/${nameWords.length} words (${(matchRatio * 100).toFixed(0)}%)`);
              console.error(`   DetailUrl: ${businessClone.detailUrl.substring(0, 100)}...`);
              console.error(`   ⚠️ SKIPPING phone extraction untuk avoid wrong data!`);
              shouldSkipPhoneExtraction = true;
            } else if (matchRatio >= 0.4) {
              console.log(`✅ [WORKER ${workerId}] DetailUrl validated for "${businessClone.name}" [Index: ${index}] - ${(matchRatio * 100).toFixed(0)}% match`);
            } else if (nameWords.length <= 1) {
              // Jika business name terlalu pendek (1 kata), skip validasi tapi log warning
              console.warn(`⚠️ [WORKER ${workerId}] Business name terlalu pendek untuk validasi detailUrl: "${businessClone.name}"`);
            }
          }
          
          try {
            console.log(`🚀 [WORKER ${workerId}] TAB-${workerId} Processing: ${businessClone.name} [Index: ${index}] (${processedCount + 1}/${totalToProcess})`);
            console.log(`   DetailUrl from array: ${businessClone.detailUrl ? businessClone.detailUrl.substring(0, 80) + '...' : 'N/A'}`);

            const needsPhone = !businessClone.phone || businessClone.phone === 'N/A';

            if (needsPhone) {
              // VALIDASI: Skip jika bisnis ini punya duplicate detailUrl
              if (duplicateDetailUrlBusinesses.includes(index)) {
                console.warn(`⚠️ [WORKER ${workerId}] Skipping phone extraction for ${businessClone.name} [Index: ${index}] - Duplicate detailUrl detected`);
                businessClone.phone = 'N/A';
                businessClone.email = 'N/A';
                businessClone.capacity = 'N/A';
              }
              // VALIDASI: Skip jika detailUrl validation gagal
              else if (shouldSkipPhoneExtraction) {
                console.warn(`⚠️ [WORKER ${workerId}] Skipping phone extraction for ${businessClone.name} [Index: ${index}] - DetailUrl validation failed`);
                businessClone.phone = 'N/A';
                businessClone.email = 'N/A';
                businessClone.capacity = 'N/A';
              }
              // VALIDASI: Pastikan detailUrl ada
              else if (!businessClone.detailUrl || businessClone.detailUrl === '') {
                console.warn(`⚠️ [WORKER ${workerId}] No detailUrl for ${businessClone.name} [Index: ${index}] - Skipping phone extraction`);
                businessClone.phone = 'N/A';
                businessClone.email = 'N/A';
                businessClone.capacity = 'N/A';
              } else {
                // Semua validasi pass, lanjutkan phone extraction
                const urlBusinessName = businessClone.detailUrl.match(/place\/([^/]+)/)?.[1]?.replace(/\+/g, ' ') || '';
                console.log(`🔗 [WORKER ${workerId}] Processing ${businessClone.name} [Index: ${index}]`);
                console.log(`   DetailUrl: ${businessClone.detailUrl.substring(0, 80)}...`);
                console.log(`   URL business name: "${urlBusinessName}"`);
              
                // Pass page (search list) untuk fallback click, workerPage (detail) untuk extract
                const { phone, email, capacity } = await this.getPhoneNumberWorker(browser, page, workerPage, businessClone, index);
                if (phone && phone.length >= 8) {
                  businessClone.phone = phone;
                  console.log(`📞 [WORKER ${workerId}] ✅ Found CORRECT phone for ${businessClone.name} [Index: ${index}]: ${phone}`);
                } else if (needsPhone) {
                  businessClone.phone = 'N/A';
                  console.log(`❌ [WORKER ${workerId}] No phone found for ${businessClone.name} [Index: ${index}]`);
                }

                if (email) {
                  businessClone.email = email;
                  console.log(`📧 [WORKER ${workerId}] ✅ Found Email for ${businessClone.name} [Index: ${index}]: ${email}`);
                } else {
                  businessClone.email = businessClone.email || 'N/A';
                }

                if (capacity) {
                  businessClone.capacity = capacity;
                  console.log(`📊 [WORKER ${workerId}] ✅ Found Capacity for ${businessClone.name} [Index: ${index}]: ${capacity}`);
                } else {
                  businessClone.capacity = businessClone.capacity || 'N/A';
                }
              }
            }
            
            // Update original business object di businessesToProcess array (bukan di queue!)
            businessClone.keyword = keyword;
            businessClone.rating = businessClone.rating || 'N/A';
            businessClone.address = businessClone.address || 'N/A';
            businessClone.category = businessClone.category || 'N/A';
            
            // CRITICAL: Update business di businessesToProcess array dengan index yang benar
            if (index >= 0 && index < businessesToProcess.length) {
              Object.assign(businessesToProcess[index], businessClone);
              console.log(`✅ [WORKER ${workerId}] Completed: ${businessClone.name} [Index: ${index}] - Phone: ${businessClone.phone}`);
            } else {
              console.error(`❌ [WORKER ${workerId}] Invalid index ${index} for ${businessClone.name}`);
            }
            
            processedCount++;
          } catch (error) {
            console.error(`❌ [WORKER ${workerId}] Error: ${businessClone.name} [Index: ${index}] - ${error.message}`);
            // Update businessesToProcess array dengan error state
            if (index >= 0 && index < businessesToProcess.length) {
              businessesToProcess[index].phone = businessesToProcess[index].phone || 'N/A';
            }
            processedCount++;
          }

          // Update session progress setiap item (avoid too frequent updates, use every 1)
          if (processedCount % 1 === 0) {
            try {
              await sessionService.updateSession(sessionId, {
                currentIndex: processedCount,
                totalFound: totalToProcess,
                phase: 'processing',
              });
              await sessionService.updateKeywordSummary(sessionId, keyword, {
                processed: processedCount,
                totalFound: totalToProcess,
              });
            } catch (e) {
              // Ignore update errors
            }
          }

          // Delay untuk avoid detection
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } finally {
        try {
          await workerPage.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    };

    // Jalankan 5 workers PARALEL
    console.log(`🔥🔥🔥 Starting ${NUM_WORKERS} PARALLEL workers...\n`);
    const workerPromises = [];
    for (let i = 1; i <= NUM_WORKERS; i++) {
      workerPromises.push(workerProcessor(i));
    }
    
    // Tunggu semua workers selesai
    await Promise.all(workerPromises);
    
    console.log(`\n✅ ALL WORKERS FINISHED - Processed ${processedCount - startFromIndex} businesses\n`);

    // Update session dengan semua hasil dari worker pool
    // Semua bisnis sudah diproses, update session final

    const completedBusinesses = businessesToProcess.map(item => ({
      ...item,
      phone: item.phone || 'N/A',
      rating: item.rating || 'N/A',
      address: item.address || 'N/A',
      category: item.category || 'N/A',
      keyword,
    }));

    await sessionService.updateSession(sessionId, {
      results: [...otherResults, ...completedBusinesses],
      currentIndex: completedBusinesses.length,  // Progress: sudah process berapa banyak
      totalFound: completedBusinesses.length,     // Total: semua bisnis yang ditemukan
      currentKeywordIndex: keywordIndex + 1,
      currentKeyword: session.keywords[keywordIndex + 1] || null,
    });

    await sessionService.updateKeywordSummary(sessionId, keyword, {
      status: 'completed',
      processed: completedBusinesses.length,
      totalFound: completedBusinesses.length,
    });

    console.log(`✅ Keyword "${keyword}" selesai diproses (${completedBusinesses.length} bisnis).`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async scrollResultsWithSession(page, maxResults, sessionId) {
    const scrollableSelector = 'div[role="feed"]';
    
    try {
      let previousHeight = 0;
      let previousItemCount = 0;
      let noChangeCount = 0;
      const maxNoChange = 10;
      let scrollCount = 0;
      const maxScrollAttempts = 100;
      
      console.log('🔄 Starting infinite scroll...');
      
      while (scrollCount < maxScrollAttempts) {
        // Check session status
        const session = sessionService.getSession(sessionId);
        if (!session || session.status !== 'running') {
          console.log(`⏸️ Session ${sessionId} stopped during scroll`);
          break;
        }

        const scrollResult = await page.evaluate((selector) => {
          const scrollable = document.querySelector(selector);
          if (scrollable) {
            const beforeHeight = scrollable.scrollHeight;
            const beforeScrollTop = scrollable.scrollTop;
            const scrollStep = Math.max(scrollable.clientHeight - 400, 400);
            scrollable.scrollBy(0, scrollStep);
            if (scrollable.scrollTop === beforeScrollTop) {
              scrollable.scrollTop = scrollable.scrollHeight;
            }
            
            return {
              scrollHeight: scrollable.scrollHeight,
              scrollTop: scrollable.scrollTop,
              changed: scrollable.scrollTop !== beforeScrollTop || scrollable.scrollHeight !== beforeHeight
            };
          }
          return { scrollHeight: 0, scrollTop: 0, changed: false };
        }, scrollableSelector);
        
        await new Promise(resolve => setTimeout(resolve, 2500));

        const clickedMorePlaces = await page.evaluate(() => {
          const button = document.querySelector('button[jsaction*="pane.paginationSection.morePlaces"], button[aria-label*="More places"], button[aria-label*="Lebih banyak tempat"]');
          if (button && !button.disabled) {
            button.click();
            return true;
          }
          return false;
        });
        if (clickedMorePlaces) {
          console.log('➡️ Clicked "More places" button to load additional results');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        const currentItemCount = await page.evaluate(() => {
          return document.querySelectorAll('div[role="feed"] div[jsaction]').length;
        });
        
        const currentHeight = scrollResult.scrollHeight;
        
        const hasHeightChange = currentHeight !== previousHeight;
        const hasItemChange = currentItemCount !== previousItemCount;
        
        if (hasHeightChange || hasItemChange) {
          noChangeCount = 0;
          console.log(`📊 Scroll ${scrollCount + 1}: Found ${currentItemCount} items (height: ${currentHeight})`);
          
          // Update session dengan progress scroll (real-time)
          await sessionService.updateSession(sessionId, {
            totalFound: currentItemCount,
            currentIndex: 0,  // Reset currentIndex karena masih fase scrolling
            phase: 'scrolling',
            scrollCount: scrollCount + 1,
          });
        } else {
          noChangeCount++;
          console.log(`📊 Scroll ${scrollCount + 1}: No change (${noChangeCount}/${maxNoChange})`);
          
          if (noChangeCount >= maxNoChange) {
            console.log(`✅ Scroll completed: No new data after ${maxNoChange} consecutive scrolls`);
            break;
          }
        }
        
        if (maxResults && currentItemCount >= maxResults) {
          console.log(`✅ Reached requested maxResults limit (${maxResults})`);
          await sessionService.updateSession(sessionId, {
            totalFound: currentItemCount
          });
          break;
        }
        
        previousHeight = currentHeight;
        previousItemCount = currentItemCount;
        scrollCount++;
        
        if (scrollCount > 10 && currentItemCount === previousItemCount && noChangeCount >= 3) {
          console.log(`✅ Scroll completed: Reached stable state`);
          break;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log(`✅ Scroll finished after ${scrollCount} attempts`);
      
    } catch (err) {
      console.error('Scroll error:', err.message);
    }
  }

  async stopSession(sessionId) {
    // Close browser if running
    const browser = this.activeBrowsers.get(sessionId);
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error(`Error closing browser for session ${sessionId}:`, error);
      }
      this.activeBrowsers.delete(sessionId);
    }
    
    return await sessionService.stopSession(sessionId);
  }
}

module.exports = new ScraperService();
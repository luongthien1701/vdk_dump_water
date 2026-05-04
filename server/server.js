const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json()); // Để parse JSON (nếu cần trong tương lai)

// Biến lưu trữ trạng thái hệ thống
let esp32Connection = null;
let currentData = {
    humidity: 0,
    pump: "OFF",
    mode: "AUTO",
    esp32_connected: false
};

// Tạo HTTP server từ Express app
const server = http.createServer(app);

// Khởi tạo WebSocket server chia sẻ cùng port với HTTP server
const wss = new WebSocketServer({ server });

// Xử lý kết nối WebSocket từ ESP32
wss.on('connection', (ws) => {
    console.log('[WS] ESP32 Connected');
    esp32Connection = ws;
    currentData.esp32_connected = true;

    // Khi nhận được tin nhắn từ ESP32
    ws.on('message', (message) => {
        try {
            const dataString = message.toString();
            // console.log('[WS] Nhận dữ liệu từ ESP32:', dataString);
            
            const parsedData = JSON.parse(dataString);
            // Cập nhật dữ liệu hiện tại
            if (parsedData.humidity !== undefined) {
                currentData.humidity = parsedData.humidity;
            }
            if (parsedData.pump !== undefined) {
                currentData.pump = parsedData.pump;
            }
            if (parsedData.mode !== undefined) {
                currentData.mode = parsedData.mode;
            }
        } catch (error) {
            console.error('[WS] Lỗi parse JSON từ ESP32:', error);
        }
    });

    // Xử lý khi ESP32 ngắt kết nối
    ws.on('close', () => {
        console.log('[WS] ESP32 Disconnected');
        esp32Connection = null;
        currentData.esp32_connected = false;
    });

    // Bắt lỗi socket
    ws.on('error', (error) => {
        console.error('[WS] WebSocket Error:', error);
    });
});

// ==========================
// REST APIs cho Web Frontend
// ==========================

// API Lấy dữ liệu cảm biến & trạng thái
app.get('/data', (req, res) => {
    res.json(currentData);
});

// API Bật bơm
app.post('/pump/on', (req, res) => {
    console.log('[API] Yêu cầu BẬT bơm từ Web');
    if (esp32Connection && esp32Connection.readyState === esp32Connection.OPEN) {
        // Gửi lệnh xuống ESP32
        const command = JSON.stringify({ action: "ON" });
        esp32Connection.send(command);
        console.log('[WS] Đã gửi lệnh ON xuống ESP32');
        
        // Trả về success (Lưu ý: chưa chắc ESP32 đã bật ngay, tuỳ logic ESP)
        res.json({ success: true, message: "Đã gửi lệnh bật bơm" });
    } else {
        console.log('[API] Thất bại: ESP32 chưa kết nối');
        res.status(503).json({ success: false, message: "ESP32 chưa kết nối" });
    }
});

// API Tắt bơm
app.post('/pump/off', (req, res) => {
    console.log('[API] Yêu cầu TẮT bơm từ Web');
    if (esp32Connection && esp32Connection.readyState === esp32Connection.OPEN) {
        // Gửi lệnh xuống ESP32
        const command = JSON.stringify({ action: "OFF" });
        esp32Connection.send(command);
        console.log('[WS] Đã gửi lệnh OFF xuống ESP32');
        
        res.json({ success: true, message: "Đã gửi lệnh tắt bơm" });
    } else {
        console.log('[API] Thất bại: ESP32 chưa kết nối');
        res.status(503).json({ success: false, message: "ESP32 chưa kết nối" });
    }
});

// API Đổi chế độ (AUTO/MANUAL)
app.post('/mode', (req, res) => {
    console.log('[API] Yêu cầu đổi chế độ:', req.body.mode);
    if (esp32Connection && esp32Connection.readyState === esp32Connection.OPEN) {
        const command = JSON.stringify({ action: "MODE", mode: req.body.mode });
        esp32Connection.send(command);
        console.log(`[WS] Đã gửi lệnh chuyển chế độ ${req.body.mode} xuống ESP32`);
        res.json({ success: true, message: `Đã chuyển sang chế độ ${req.body.mode}` });
    } else {
        console.log('[API] Thất bại: ESP32 chưa kết nối');
        res.status(503).json({ success: false, message: "ESP32 chưa kết nối" });
    }
});

// Start Server
server.listen(PORT, () => {
    console.log(`[Server] Đang chạy tại http://localhost:${PORT}`);
});

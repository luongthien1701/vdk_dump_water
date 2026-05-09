const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const { clear } = require('console');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Biến lưu trữ trạng thái hệ thống
let esp32Connection = null;
let esp32Timeout = null;
let commandLock = false;
const ESP32_TIMEOUT_MS = 10000; // 10 giây không gửi data => offline
const webClients = new Set();
let currentData = {
    humidity: 0,
    pump: "OFF",
    mode: "AUTO",
    esp32_connected: false
};

function resetESP32Timeout() {
    clearTimeout(esp32Timeout);

    esp32Timeout = setTimeout(() => {
        console.log('[WS] ESP32 Timeout');

        currentData.esp32_connected = false;

        if (esp32Connection) {
            try {
                esp32Connection.close();
            } catch (e) {}
        }

        esp32Connection = null;

        broadcastToWebClients();
    }, ESP32_TIMEOUT_MS);
}
// Tạo HTTP server từ Express app
const server = http.createServer(app);

// Khởi tạo WebSocket server
const wss = new WebSocketServer({ server });

// Hàm gửi dữ liệu trạng thái cho tất cả Web Clients
function broadcastToWebClients() {
    const dataString = JSON.stringify(currentData);
    for (const client of webClients) {
        if (client.readyState === 1) { // 1 = OPEN
            client.send(dataString);
        }
    }
}

// Xử lý kết nối WebSocket
wss.on('connection', (ws) => {
    let isESP32 = false;
    let isWeb = false;

    // Khi nhận được tin nhắn từ bất kỳ client nào
    ws.on('message', (message) => {
        try {
            const dataString = message.toString();
            const parsedData = JSON.parse(dataString);

            // 1. Phân biệt client là Web Client
            if (parsedData.client === "WEB" && !isWeb) {
                isWeb = true;
                webClients.add(ws);
                console.log('[WS] Web Client Connected');
                // Gửi ngay trạng thái hiện tại cho Web Client mới
                ws.send(JSON.stringify(currentData));
            }

            // Nếu chỉ là gói tin định danh ban đầu (không có lệnh) thì dừng xử lý
            if (parsedData.client === "WEB" && !parsedData.action) {
                return;
            }

            // 2. Nhận lệnh điều khiển từ Web Client
            if (isWeb && parsedData.action) {

                if (commandLock) {
                    ws.send(JSON.stringify({
                        error: "System busy"
                    }));
                    return;
                }

                if (esp32Connection && esp32Connection.readyState === 1) {

                    commandLock = true;

                    let commandObj = {
                        action: parsedData.action
                    };

                    if (parsedData.mode)
                        commandObj.mode = parsedData.mode;

                    if (
                        parsedData.action === 'CONFIG' &&
                        parsedData.config
                    ) {
                        commandObj.config = parsedData.config;
                    }

                    esp32Connection.send(JSON.stringify(commandObj));

                    // unlock sau 1s
                    setTimeout(() => {
                        commandLock = false;
                    }, 1000);
                }

                return;
            }

            // 3. Xử lý dữ liệu từ ESP32 (Nếu không phải Web, và có chứa data cảm biến)
            if (!isWeb && (parsedData.humidity !== undefined || parsedData.pump !== undefined || parsedData.mode !== undefined)) {
                resetESP32Timeout(); // Reset timeout khi nhận được data từ ESP32

                if (!isESP32) {
                    isESP32 = true;
                    esp32Connection = ws;
                    currentData.esp32_connected = true;
                    console.log('[WS] ESP32 Connected/Identified');
                    broadcastToWebClients(); // Báo cho web biết ESP32 đã online
                }

                // Cập nhật dữ liệu hiện tại
                if (parsedData.humidity !== undefined) currentData.humidity = parsedData.humidity;
                if (parsedData.pump !== undefined) currentData.pump = parsedData.pump;
                if (parsedData.mode !== undefined) currentData.mode = parsedData.mode;

                // Broadcast thông tin mới nhất cho tất cả Web Clients
                broadcastToWebClients();
            }
        } catch (error) {
            console.error('[WS] Lỗi parse JSON:', error);
        }
    });

    // Xử lý khi client ngắt kết nối
    ws.on('close', () => {
        if (isWeb) {
            console.log('[WS] Web Client Disconnected');
            webClients.delete(ws);
        }
        if (isESP32) {
            console.log('[WS] ESP32 Disconnected');
            clearTimeout(esp32Timeout);
            esp32Connection = null;
            currentData.esp32_connected = false;
            broadcastToWebClients(); // Báo cho web biết ESP32 đã offline
        }
    });

    // Bắt lỗi socket
    ws.on('error', (error) => {
        console.error('[WS] WebSocket Error:', error);
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`[Server] Đang chạy tại http://localhost:${PORT}`);
});
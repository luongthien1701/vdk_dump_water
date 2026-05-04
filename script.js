// Khai báo địa chỉ WebSocket Server
const WS_URL = "ws://localhost:3000";

// Lấy các phần tử DOM cần thiết để tương tác
const humidityValue = document.getElementById('humidity-value');
const pumpStatus = document.getElementById('pump-status');
const connectionStatus = document.getElementById('connection-status');
const esp32Status = document.getElementById('esp32-status');
const loadingIndicator = document.getElementById('loading-indicator');
const btnOn = document.getElementById('btn-on');
const btnOff = document.getElementById('btn-off');
const btnMode = document.getElementById('btn-mode');
const cmdLogContainer = document.getElementById('cmd-log-container');
const dataLogContainer = document.getElementById('data-log-container');

let isAutoMode = true;

function addLog(container, message) {
    if (!container) return;
    const entry = document.createElement('div');
    entry.className = `log-entry`;
    entry.textContent = message;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}

// SVG Animation Elements
const motorWheel = document.getElementById('motor-wheel');
const waterFlow = document.getElementById('water-flow');
const waterDrops = document.getElementById('water-drops');
const soilMoistureOverlay = document.getElementById('soil-moisture-overlay');
const humidityCircle = document.getElementById('humidity-circle');

// Hàm hiển thị trạng thái loading khi đang fetch dữ liệu
function showLoading(show) {
    if (show) {
        loadingIndicator.classList.remove('hidden');
    } else {
        loadingIndicator.classList.add('hidden');
    }
}

// Hàm cập nhật hiển thị trạng thái kết nối với Server và ESP32
function updateConnectionStatus(isServerConnected, isEsp32Connected = false) {
    if (isServerConnected) {
        connectionStatus.textContent = "Connected";
        connectionStatus.className = "status-badge connected";
    } else {
        connectionStatus.textContent = "Disconnected";
        connectionStatus.className = "status-badge disconnected";
    }

    if (isEsp32Connected) {
        esp32Status.textContent = "Online";
        esp32Status.className = "status-badge connected";
    } else {
        esp32Status.textContent = "Offline";
        esp32Status.className = "status-badge disconnected";

        // Nếu ESP32 offline, reset dữ liệu hiển thị
        if (!isServerConnected || !isEsp32Connected) {
            updateUI({ humidity: '--', pump: 'Unknown' });
        }
    }
}

// Hàm cập nhật giao diện (UI) và Animation
function updateUI(data) {
    // 1. Cập nhật giá trị độ ẩm và UI
    if (data.humidity !== undefined && data.humidity !== '--') {
        const h = parseInt(data.humidity);
        humidityValue.textContent = h + '%';

        // Vòng tròn độ ẩm: thiết lập độ dài stroke (0 - 100)
        humidityCircle.setAttribute('stroke-dasharray', `${h}, 100`);

        // Đổi màu vòng tròn theo mức độ ẩm
        if (h < 30) {
            humidityCircle.style.stroke = '#f56565'; // Đỏ (Khô)
        } else if (h < 60) {
            humidityCircle.style.stroke = '#ed8936'; // Cam (Vừa)
        } else {
            humidityCircle.style.stroke = '#4299e1'; // Xanh (Ẩm)
        }

        // Animation SVG: Làm cho lớp đất phía dưới thay đổi độ đậm nhạt (ẩm ướt hơn)
        // Mức opacity thay đổi từ 0.1 đến 0.8 dựa theo %
        const opacity = 0.1 + (h / 100) * 0.7;
        soilMoistureOverlay.style.opacity = opacity;

    } else if (data.humidity === '--') {
        humidityValue.textContent = '--%';
        humidityCircle.setAttribute('stroke-dasharray', `0, 100`);
        humidityCircle.style.stroke = '#cbd5e0';
        soilMoistureOverlay.style.opacity = 0;
    }

    // 2. Cập nhật trạng thái máy bơm và Animation SVG
    if (data.pump) {
        let isON = data.pump.toUpperCase() === "ON";
        pumpStatus.textContent = isON ? "ON" : "OFF";
        pumpStatus.className = isON ? "badge on" : "badge off";

        if (data.pump === 'Unknown') {
            pumpStatus.textContent = "Unknown";
            pumpStatus.className = "badge unknown";
            isON = false;
        }

        if (isON) {
            // Chạy Animation khi bơm BẬT
            motorWheel.classList.add('motor-running');
            waterFlow.classList.remove('stopped');
            waterFlow.classList.add('running');
            waterDrops.classList.remove('hidden');
        } else {
            // Dừng Animation khi bơm TẮT
            motorWheel.classList.remove('motor-running');
            waterFlow.classList.add('stopped');
            waterFlow.classList.remove('running');
            waterDrops.classList.add('hidden');
        }
    }

    // 3. Cập nhật chế độ
    if (data.mode) {
        isAutoMode = data.mode === "AUTO";
        btnMode.textContent = isAutoMode ? "Tự động" : "Thủ công";
        btnMode.className = isAutoMode ? "badge auto" : "badge manual";

        // Vô hiệu hóa nút Bật/Tắt nếu đang ở chế độ Tự động
        btnOn.disabled = isAutoMode;
        btnOff.disabled = isAutoMode;

        if (isAutoMode) {
            btnOn.style.opacity = '0.5';
            btnOff.style.opacity = '0.5';
            btnOn.style.cursor = 'not-allowed';
            btnOff.style.cursor = 'not-allowed';
        } else {
            btnOn.style.opacity = '1';
            btnOff.style.opacity = '1';
            btnOn.style.cursor = 'pointer';
            btnOff.style.cursor = 'pointer';
        }
    }
}

// Khởi tạo kết nối WebSocket
let socket = null;

function initWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("Đã kết nối tới WebSocket server");
        updateConnectionStatus(true);
        // Định danh là Web Client
        socket.send(JSON.stringify({ client: "WEB" }));
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateConnectionStatus(true, data.esp32_connected);

            if (data.esp32_connected) {
                updateUI(data);
                if (data.humidity !== undefined) {
                    const esp32Data = { humidity: data.humidity, pump: data.pump, mode: data.mode };
                    addLog(dataLogContainer, `${JSON.stringify(esp32Data)}`);
                }
            }
        } catch (error) {
            console.error("Lỗi parse JSON từ server:", error);
        }
    };

    socket.onclose = () => {
        console.log("Mất kết nối server. Đang thử lại sau 3s...");
        updateConnectionStatus(false, false);
        setTimeout(initWebSocket, 3000);
    };

    socket.onerror = (error) => {
        console.error("Lỗi WebSocket:", error);
        socket.close();
    };
}

// Hàm gửi yêu cầu BẬT bơm
function turnOnPump() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    btnOn.disabled = true;
    updateUI({ pump: "ON", humidity: humidityValue.textContent.replace('%', '') });
    socket.send(JSON.stringify({ client: "WEB", action: "ON" }));
    addLog(cmdLogContainer, `[WS] Nhận lệnh từ Web: ON`);
    setTimeout(() => { btnOn.disabled = isAutoMode; }, 500);
}

// Hàm gửi yêu cầu TẮT bơm
function turnOffPump() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    btnOff.disabled = true;
    updateUI({ pump: "OFF", humidity: humidityValue.textContent.replace('%', '') });
    socket.send(JSON.stringify({ client: "WEB", action: "OFF" }));
    addLog(cmdLogContainer, `[WS] Nhận lệnh từ Web: OFF`);
    setTimeout(() => { btnOff.disabled = isAutoMode; }, 500);
}

// Hàm đổi chế độ (AUTO / MANUAL)
function toggleMode() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    btnMode.disabled = true;
    const newMode = isAutoMode ? "MANUAL" : "AUTO";
    updateUI({ mode: newMode, pump: pumpStatus.textContent, humidity: humidityValue.textContent.replace('%', '') });
    socket.send(JSON.stringify({ client: "WEB", action: "MODE", mode: newMode }));
    addLog(cmdLogContainer, `[WS] Nhận lệnh từ Web: MODE`);
    setTimeout(() => { btnMode.disabled = false; }, 500);
}

// Khởi tạo khi trang load xong
document.addEventListener("DOMContentLoaded", () => {
    initWebSocket();
});
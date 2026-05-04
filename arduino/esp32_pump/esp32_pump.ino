#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// =======================
// Cấu hình mạng & Server
// =======================
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// IP của máy tính đang chạy Node.js Server
const char* server_host = "192.168.1.x"; 
const uint16_t server_port = 3000;

WebSocketsClient webSocket;

// =======================
// Trạng thái hệ thống
// =======================
unsigned long lastDataTime = 0;
unsigned long previousMillis = 0;
unsigned long lastIdleMillis = 0;

bool isPumpOn = false;
bool isAutoMode = true;
int currentSoilValue = 4095; // Mặc định là khô

enum State { INIT, IDLE, PUMPING, WAIT };
State currentState = INIT;

// =======================
// Cấu hình phần cứng
// =======================
#define SOIL_PIN 0
#define RELAY_PIN 4

// =======================
// Các ngưỡng cấu hình
// =======================
#define DRY_THRESHOLD 3000
#define PUMP_TIME 500
#define WAIT_TIME 5000
#define SAMPLE_SIZE 7
#define INIT_TIME 3000

// =======================
// Hàm tiện ích
// =======================
void setPumpState(bool state) {
  isPumpOn = state;
  digitalWrite(RELAY_PIN, state ? HIGH : LOW);
}

int getMedianValue() {
  int arr[SAMPLE_SIZE];

  for (int i = 0; i < SAMPLE_SIZE; i++) {
    arr[i] = analogRead(SOIL_PIN);
    delay(20); 
  }

  // Sắp xếp mảng (Bubble sort)
  for (int i = 0; i < SAMPLE_SIZE - 1; i++) {
    for (int j = i + 1; j < SAMPLE_SIZE; j++) {
      if (arr[i] > arr[j]) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
      }
    }
  }

  // Trả về giá trị trung vị
  return arr[SAMPLE_SIZE / 2];
}

// =======================
// Khởi tạo hệ thống
// =======================
void setupWiFi() {
  Serial.print("Đang kết nối WiFi");
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nKết nối WiFi thành công!");
  Serial.print("IP ESP32: ");
  Serial.println(WiFi.localIP());
}

// =======================
// Xử lý WebSocket
// =======================
void processWebSocketMessage(uint8_t * payload) {
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) return;

  if (doc.containsKey("action")) {
    const char* action = doc["action"];
    
    // Lệnh bật bơm
    if (strcmp(action, "ON") == 0) {
      if (!isAutoMode) {
        Serial.println("-> [WEB] Lệnh BẬT bơm (Thủ công)");
        setPumpState(true);
        currentState = PUMPING;
        previousMillis = millis(); 
      } else {
        Serial.println("-> [WEB] Bo qua lenh ON vi dang o che do AUTO");
      }
    } 
    // Lệnh tắt bơm
    else if (strcmp(action, "OFF") == 0) {
      if (!isAutoMode) {
        Serial.println("-> [WEB] Lệnh TẮT bơm (Thủ công)");
        setPumpState(false);
        currentState = WAIT;
        previousMillis = millis();
      } else {
        Serial.println("-> [WEB] Bo qua lenh OFF vi dang o che do AUTO");
      }
    }
    // Lệnh chuyển chế độ
    else if (strcmp(action, "MODE") == 0) {
      const char* mode = doc["mode"];
      if (strcmp(mode, "AUTO") == 0) {
          Serial.println("-> [WEB] Chuyen che do: AUTO");
          isAutoMode = true;
          currentState = IDLE; // Đặt lại trạng thái để hệ thống tự động kiểm tra lại cảm biến
      } else if (strcmp(mode, "MANUAL") == 0) {
          Serial.println("-> [WEB] Chuyen che do: MANUAL");
          isAutoMode = false;
          setPumpState(false); // Tắt bơm để an toàn khi mới chuyển sang thủ công
          currentState = IDLE;
      }
    }
  }
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Đã ngắt kết nối khỏi Server.");
      break;
    case WStype_CONNECTED:
      Serial.printf("[WS] Đã kết nối tới url: %s\n", payload);
      break;
    case WStype_TEXT:
      processWebSocketMessage(payload);
      break;
  }
}

// =======================
// Logic chính (State Machine)
// =======================
void updateStateMachine(unsigned long currentMillis) {
  switch (currentState) {
    case INIT:
      if (currentMillis - previousMillis >= INIT_TIME) {
        Serial.println("=> INIT DONE");
        currentState = IDLE;
      }
      break;

    case IDLE:
      // Mỗi 1 giây đọc cảm biến 1 lần thay vì delay
      if (currentMillis - lastIdleMillis >= 1000) {
        lastIdleMillis = currentMillis;
        currentSoilValue = getMedianValue();

        Serial.print("\n[STATE] IDLE | Median Soil: ");
        Serial.println(currentSoilValue);

        // Chỉ tự động điều khiển bơm khi ở chế độ AUTO
        if (isAutoMode) {
          if (currentSoilValue > DRY_THRESHOLD) {
            Serial.println("=> DAT KHO -> BAT BOM");
            setPumpState(true);
            previousMillis = currentMillis;
            currentState = PUMPING;
          } else {
            Serial.println("=> Dat OK -> KHONG BOM");
            setPumpState(false);
          }
        }
      }
      break;

    case PUMPING:
      if (isAutoMode && (currentMillis - previousMillis >= PUMP_TIME)) {
        Serial.println("[STATE] PUMPING... => Tat bom");
        setPumpState(false);
        previousMillis = currentMillis;
        currentState = WAIT;
      }
      break;

    case WAIT:
      if (currentMillis - previousMillis >= WAIT_TIME) {
        Serial.println("[STATE] WAIT... => Quay lai do");
        currentState = IDLE;
      }
      break;
  }
}

// =======================
// Gửi dữ liệu lên Server
// =======================
void sendDataToServer(unsigned long currentMillis) {
  if (currentMillis - lastDataTime >= 2000) {
    lastDataTime = currentMillis;
    
    // Quy đổi giá trị soil raw (0-4095) thành độ ẩm %
    int humidityPercent = map(currentSoilValue, 4095, 1000, 0, 100);
    humidityPercent = constrain(humidityPercent, 0, 100); // Thay thế cho if else cồng kềnh

    StaticJsonDocument<200> doc;
    doc["humidity"] = humidityPercent;
    doc["pump"] = isPumpOn ? "ON" : "OFF";
    doc["mode"] = isAutoMode ? "AUTO" : "MANUAL";
    
    char jsonString[200];
    serializeJson(doc, jsonString);
    
    webSocket.sendTXT(jsonString);
  }
}

// =======================
// Setup & Loop
// =======================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(RELAY_PIN, OUTPUT);
  setPumpState(false); // luôn tắt bơm khi start

  Serial.println("=== START SYSTEM ===");
  Serial.println("Pump OFF at startup");

  setupWiFi();

  webSocket.begin(server_host, server_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  previousMillis = millis();
}

void loop() {
  webSocket.loop();
  
  unsigned long currentMillis = millis();

  updateStateMachine(currentMillis);
  sendDataToServer(currentMillis);
}

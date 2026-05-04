#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// =======================
// Config
// =======================
const char* ssid = "...";
const char* password = "12345678";
const char* server_host = "20.189.124.16";
const uint16_t server_port = 80;

#define SOIL_PIN 0
#define RELAY_PIN 4

#define DRY_THRESHOLD 3000
#define PUMP_TIME 2000
#define WAIT_TIME 5000
#define SAMPLE_SIZE 7
#define INIT_TIME 3000

WebSocketsClient webSocket;

// =======================
// State
// =======================
enum State { INIT, IDLE, PUMPING, WAIT };
enum Action { ACT_UNKNOWN, ACT_ON, ACT_OFF, ACT_MODE };

State currentState = INIT;

bool isPumpOn = false;
bool isAutoMode = true;
bool pumpChanged = false;

unsigned long previousMillis = 0;
unsigned long lastSample = 0;
unsigned long lastSend = 0;

int soilValue = 4095;

// =======================
// Utils
// =======================
void setPump(bool on) {
  if (isPumpOn == on) return;
  isPumpOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  pumpChanged = true;
}

int readSoil() {
  int arr[SAMPLE_SIZE];
  for (int i = 0; i < SAMPLE_SIZE; i++) arr[i] = analogRead(SOIL_PIN);

  for (int i = 0; i < SAMPLE_SIZE - 1; i++)
    for (int j = i + 1; j < SAMPLE_SIZE; j++)
      if (arr[i] > arr[j]) std::swap(arr[i], arr[j]);

  return arr[SAMPLE_SIZE / 2];
}

Action parseAction(const char* a) {
  if (!a) return ACT_UNKNOWN;
  if (!strcmp(a, "ON")) return ACT_ON;
  if (!strcmp(a, "OFF")) return ACT_OFF;
  if (!strcmp(a, "MODE")) return ACT_MODE;
  return ACT_UNKNOWN;
}

// =======================
// WebSocket
// =======================
void handleMessage(uint8_t* payload) {
  StaticJsonDocument<200> doc;
  if (deserializeJson(doc, payload)) return;

  Action action = parseAction(doc["action"]);
  bool changed = false;

  switch (isAutoMode) {

    // ================= AUTO =================
    case true:
      switch (action) {
        case ACT_MODE:
          if (!strcmp(doc["mode"], "MANUAL")) {
            isAutoMode = false;
            setPump(false);
            currentState = IDLE;
            changed = true;
          }
          break;

        case ACT_ON:
        case ACT_OFF:
          Serial.println("AUTO -> ignore");
          break;

        default: return;
      }
      break;

    // ================= MANUAL =================
    case false:
      switch (action) {
        case ACT_ON:
          setPump(true);
          changed = true;
          break;

        case ACT_OFF:
          setPump(false);
          changed = true;
          break;

        case ACT_MODE:
          if (!strcmp(doc["mode"], "AUTO")) {
            isAutoMode = true;
            currentState = IDLE;
            changed = true;
          }
          break;

        default: return;
      }
      break;
  }

  if (changed) sendDataToServer(millis(), true);
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_TEXT: handleMessage(payload); break;
    case WStype_CONNECTED: Serial.println("[WS] Connected"); break;
    case WStype_DISCONNECTED: Serial.println("[WS] Disconnected"); break;
  }
}

// =======================
// State Machine
// =======================
void updateState(unsigned long now) {
  switch (currentState) {

    case INIT:
      if (now - previousMillis < INIT_TIME) return;
      currentState = IDLE;
      break;

    case IDLE:
      if (!isAutoMode) return;
      if (soilValue <= DRY_THRESHOLD) {
        setPump(false);
        return;
      }
      setPump(true);
      previousMillis = now;
      currentState = PUMPING;
      break;

    case PUMPING:
      if (now - previousMillis < PUMP_TIME) return;
      setPump(false);
      previousMillis = now;
      currentState = WAIT;
      break;

    case WAIT:
      if (now - previousMillis < WAIT_TIME) return;
      currentState = IDLE;
      break;
  }
}

// =======================
// Send Data
// =======================
void sendDataToServer(unsigned long now, bool force) {
  if (!force && now - lastSend < 1000) return;
  lastSend = now;

  int humidity = constrain(map(soilValue, 4095, 0, 0, 100), 0, 100);

  StaticJsonDocument<200> doc;
  doc["humidity"] = humidity;
  doc["pump"] = isPumpOn ? "ON" : "OFF";
  doc["mode"] = isAutoMode ? "AUTO" : "MANUAL";

  char json[200];
  serializeJson(doc, json);
  webSocket.sendTXT(json);
}

// =======================
// Setup / Loop
// =======================
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  setPump(false);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  webSocket.begin(server_host, server_port, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  previousMillis = millis();
}

void loop() {
  webSocket.loop();
  unsigned long now = millis();

  if (now - lastSample >= 1000) {
    lastSample = now;
    soilValue = readSoil();
  }

  updateState(now);

  if (pumpChanged) {
    sendDataToServer(now, true);
    pumpChanged = false;
  } else {
    sendDataToServer(now, false);
  }
}
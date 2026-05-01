// src/main.cpp — Rain Barrel Controller

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "secrets.h"

// ── Pins ──────────────────────────────────────────────────────────────────────
const int RELAY_PIN    = 26;  // HiLetgo relay IN (active LOW: LOW = pump ON)
const int FLOW_PIN     = 27;  // YF-S201 signal wire
const int PRESSURE_PIN = 34;  // SEN0257 analog out

// SEN0257 voltage divider: 10kΩ → 20kΩ, scales 4.5V → 3.0V
const float DIVIDER_RATIO = 20.0f / (10.0f + 20.0f);

#define RELAY_ON  HIGH
#define RELAY_OFF LOW

// ── Device config (persisted in NVS via Preferences) ─────────────────────────
// To set config over serial, flash a one-time setup sketch that calls prefs.putString()/putFloat().
// Defaults match a standard 55-gallon drum.
struct DeviceConfig {
  char  friendly_name[64];
  char  container_type[16];  // "barrel" | "tote" | "tank"
  float capacity_gal;
  float height_in;
  float sensor_offset_in;    // inches from sensor face to the 0-fill waterline
};

static DeviceConfig cfg;
Preferences prefs;

// ── MQTT topics (derived from MAC address at boot) ────────────────────────────
String DEVICE_ID;
String TOPIC_CMD;
String TOPIC_STATUS;
String TOPIC_LWT;
String TOPIC_CONFIG;
String TOPIC_CONFIG_SET;
const char* TOPIC_DISCOVER = "barrel/discover";

// ── Sensor state ──────────────────────────────────────────────────────────────
bool  pumpState    = false;
float pressureKpa  = 0.0f;
float flowRate_Lpm = 0.0f;
float totalLiters  = 0.0f;

volatile uint32_t pulseCount = 0;
unsigned long lastFlowMs = 0;
unsigned long lastFillMs = 0;

WiFiClientSecure espClient;
PubSubClient     mqtt(espClient);

// ── Flow ISR ──────────────────────────────────────────────────────────────────
void IRAM_ATTR flowPulseISR() { pulseCount++; }

// ── Config ────────────────────────────────────────────────────────────────────
void loadConfig() {
  prefs.begin("device-cfg", true);
  prefs.getString("name",      cfg.friendly_name,  sizeof(cfg.friendly_name));
  prefs.getString("type",      cfg.container_type, sizeof(cfg.container_type));
  cfg.capacity_gal     = prefs.getFloat("cap_gal",   55.0f);
  cfg.height_in        = prefs.getFloat("height_in", 33.5f);
  cfg.sensor_offset_in = prefs.getFloat("offset_in",  0.0f);
  prefs.end();

  if (cfg.friendly_name[0]  == '\0') strlcpy(cfg.friendly_name,  "Rain Barrel", sizeof(cfg.friendly_name));
  if (cfg.container_type[0] == '\0') strlcpy(cfg.container_type, "barrel",      sizeof(cfg.container_type));
}

void saveConfig() {
  prefs.begin("device-cfg", false);
  prefs.putString("name",      cfg.friendly_name);
  prefs.putString("type",      cfg.container_type);
  prefs.putFloat ("cap_gal",   cfg.capacity_gal);
  prefs.putFloat ("height_in", cfg.height_in);
  prefs.putFloat ("offset_in", cfg.sensor_offset_in);
  prefs.end();
}

// ── Pressure → water level ────────────────────────────────────────────────────
// Hydrostatic: 1 inch H₂O ≈ 0.249 kPa → 1 kPa ≈ 4.015 inches
float waterLevelIn() {
  float inches = (pressureKpa / 0.249f) - cfg.sensor_offset_in;
  return constrain(inches, 0.0f, cfg.height_in);
}

// ── MQTT publish ──────────────────────────────────────────────────────────────
void publishConfig() {
  char buf[256];
  snprintf(buf, sizeof(buf),
    "{\"device_id\":\"%s\","
    "\"friendly_name\":\"%s\","
    "\"container_type\":\"%s\","
    "\"capacity_gal\":%.1f,"
    "\"height_in\":%.1f,"
    "\"sensor_offset_in\":%.2f}",
    DEVICE_ID.c_str(),
    cfg.friendly_name,
    cfg.container_type,
    cfg.capacity_gal,
    cfg.height_in,
    cfg.sensor_offset_in
  );
  mqtt.publish(TOPIC_CONFIG.c_str(), buf, true);  // retained
}

void publishStatus() {
  char buf[256];
  snprintf(buf, sizeof(buf),
    "{\"pump\":%s,"
    "\"pressure_kpa\":%.2f,"
    "\"water_level_in\":%.2f,"
    "\"flow_lpm\":%.2f,"
    "\"total_L\":%.3f,"
    "\"uptime\":%lu,"
    "\"rssi\":%d}",
    pumpState ? "true" : "false",
    pressureKpa,
    waterLevelIn(),
    flowRate_Lpm,
    totalLiters,
    millis() / 1000UL,
    WiFi.RSSI()
  );
  mqtt.publish(TOPIC_STATUS.c_str(), buf, true);  // retained
  Serial.println("Published: " + String(buf));
}

// ── Pump control ──────────────────────────────────────────────────────────────
void setPump(bool on) {
  pumpState = on;
  digitalWrite(RELAY_PIN, on ? RELAY_ON : RELAY_OFF);
  Serial.println("Pump: " + String(on ? "ON" : "OFF"));
  publishStatus();
}

// ── MQTT callback ─────────────────────────────────────────────────────────────
void onMessage(char* topic, byte* payload, unsigned int length) {
  String topicStr(topic);
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];
  Serial.println("Received on " + topicStr + ": " + message);

  if (topicStr == TOPIC_CMD) {
    if      (message == "pump_on")     setPump(true);
    else if (message == "pump_off")    setPump(false);
    else if (message == "pump_toggle") setPump(!pumpState);
  } else if (topicStr == TOPIC_DISCOVER) {
    publishConfig();
  } else if (topicStr == TOPIC_CONFIG_SET) {
    JsonDocument doc;
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      if (doc["friendly_name"].is<const char*>())
        strlcpy(cfg.friendly_name,  doc["friendly_name"],  sizeof(cfg.friendly_name));
      if (doc["container_type"].is<const char*>())
        strlcpy(cfg.container_type, doc["container_type"], sizeof(cfg.container_type));
      if (!doc["capacity_gal"].isNull())     cfg.capacity_gal     = doc["capacity_gal"];
      if (!doc["height_in"].isNull())        cfg.height_in        = doc["height_in"];
      if (!doc["sensor_offset_in"].isNull()) cfg.sensor_offset_in = doc["sensor_offset_in"];

      saveConfig();
      publishConfig();
      Serial.println("Config updated via MQTT");
    }
  }
}

// ── WiFi + MQTT ───────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("Connecting to WiFi: %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\nWiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
}

void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting to MQTT...");
    String clientId = "esp32-" + DEVICE_ID;
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS,
                     TOPIC_LWT.c_str(), 1, true, "{\"online\":false}")) {
      Serial.println(" connected!");
      mqtt.publish(TOPIC_LWT.c_str(), "{\"online\":true}", true);
      mqtt.subscribe(TOPIC_CMD.c_str(),        1);
      mqtt.subscribe(TOPIC_CONFIG_SET.c_str(), 1);
      mqtt.subscribe(TOPIC_DISCOVER,           1);
      publishConfig();
      publishStatus();
    } else {
      Serial.printf(" failed (rc=%d). Retrying in 5s...\n", mqtt.state());
      delay(5000);
    }
  }
}

// ── Sensors ───────────────────────────────────────────────────────────────────
void updateSensors() {
  unsigned long now = millis();

  // Flow rate (YF-S201: F Hz = 7.5 × Q L/min)
  if (now - lastFlowMs >= 1000) {
    noInterrupts();
    uint32_t pulses = pulseCount;
    pulseCount = 0;
    interrupts();

    float elapsedSec = (now - lastFlowMs) / 1000.0f;
    flowRate_Lpm     = (pulses / elapsedSec) / 7.5f;
    totalLiters     += flowRate_Lpm * (elapsedSec / 60.0f);
    lastFlowMs       = now;
  }

  // Pressure (SEN0257: 0.5V = 0 kPa, 4.5V = 1200 kPa)
  if (now - lastFillMs >= 1000) {
    long sum = 0;
    for (int i = 0; i < 10; i++) sum += analogRead(PRESSURE_PIN);
    float adcVoltage    = (sum / 10.0f / 4095.0f) * 3.3f;
    float sensorVoltage = adcVoltage / DIVIDER_RATIO;
    pressureKpa         = constrain((sensorVoltage - 0.5f) / 4.0f * 1200.0f, 0.0f, 1200.0f);
    lastFillMs          = now;
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n=== Rain Barrel Controller ===");

  WiFi.mode(WIFI_STA);
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[13];
  snprintf(macStr, sizeof(macStr), "%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  DEVICE_ID = String(macStr);
  Serial.println("Device ID: " + DEVICE_ID);

  TOPIC_CMD        = "barrel/" + DEVICE_ID + "/command";
  TOPIC_STATUS     = "barrel/" + DEVICE_ID + "/status";
  TOPIC_LWT        = "barrel/" + DEVICE_ID + "/lwt";
  TOPIC_CONFIG     = "barrel/" + DEVICE_ID + "/config";
  TOPIC_CONFIG_SET = "barrel/" + DEVICE_ID + "/config/set";

  loadConfig();
  Serial.printf("Config: %s (%s, %.0f gal, %.1f\")\n",
    cfg.friendly_name, cfg.container_type, cfg.capacity_gal, cfg.height_in);

  // Set relay HIGH before pinMode to prevent startup glitch
  digitalWrite(RELAY_PIN, RELAY_OFF);
  pinMode(RELAY_PIN, OUTPUT);

  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowPulseISR, FALLING);
  lastFlowMs = millis();
  lastFillMs = millis();

  analogSetPinAttenuation(PRESSURE_PIN, ADC_11db);

  connectWiFi();
  espClient.setInsecure();  // TODO: replace with setCACert() for production
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(768);
  connectMQTT();
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected())             connectMQTT();
  mqtt.loop();

  updateSensors();

  static unsigned long lastStatus = 0;
  if (millis() - lastStatus > 30000) {
    publishStatus();
    lastStatus = millis();
  }
}

// src/main.cpp — Rain Barrel Controller

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include "secrets.h"

// ── Pins ──────────────────────────────────────────────────────────────────────
const int RELAY_PIN    = 26;  // HiLetgo relay IN (active HIGH: HIGH = pump ON)
const int FLOW_PIN     = 27;  // YF-S201 signal wire
const int PRESSURE_PIN = 34;  // SEN0257 analog out

// SEN0257 voltage divider: 10kΩ → 20kΩ, scales 4.5V → 3.0V
const float DIVIDER_RATIO = 20.0f / (10.0f + 20.0f);

#define RELAY_ON  HIGH
#define RELAY_OFF LOW

// ── Device config (persisted in NVS via Preferences) ─────────────────────────
struct DeviceConfig {
  char     friendly_name[64];
  char     container_type[16];  // "barrel" | "tote" | "tank"
  float    capacity_gal;
  float    height_in;
  float    sensor_offset_in;
  float    schedule_interval_h;    // 0 = disabled; hours between waterings
  uint16_t schedule_duration_min;  // how long to run the pump
  float    latitude;
  float    longitude;
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

// ── Schedule state ────────────────────────────────────────────────────────────
static uint32_t next_water_epoch = 0;   // unix epoch of next scheduled watering
static bool     skip_next        = false;
static uint32_t pump_off_at_ms   = 0;   // millis() at which to auto-off (0 = no timer)

WiFiClientSecure espClient;
PubSubClient     mqtt(espClient);

// ── Flow ISR ──────────────────────────────────────────────────────────────────
void IRAM_ATTR flowPulseISR() { pulseCount++; }

// ── Config ────────────────────────────────────────────────────────────────────
void loadConfig() {
  prefs.begin("device-cfg", true);
  prefs.getString("name",      cfg.friendly_name,  sizeof(cfg.friendly_name));
  prefs.getString("type",      cfg.container_type, sizeof(cfg.container_type));
  cfg.capacity_gal          = prefs.getFloat ("cap_gal",   55.0f);
  cfg.height_in             = prefs.getFloat ("height_in", 33.5f);
  cfg.sensor_offset_in      = prefs.getFloat ("offset_in",  0.0f);
  cfg.schedule_interval_h   = prefs.getFloat ("sched_int",  0.0f);
  cfg.schedule_duration_min = prefs.getUShort("sched_dur",    30);
  cfg.latitude              = prefs.getFloat ("latitude",   0.0f);
  cfg.longitude             = prefs.getFloat ("longitude",  0.0f);
  prefs.end();

  prefs.begin("schedule", true);
  next_water_epoch = prefs.getUInt("next_water", 0);
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
  prefs.putFloat ("sched_int", cfg.schedule_interval_h);
  prefs.putUShort("sched_dur", cfg.schedule_duration_min);
  prefs.putFloat ("latitude",  cfg.latitude);
  prefs.putFloat ("longitude", cfg.longitude);
  prefs.end();
}

// ── Pressure → water level ────────────────────────────────────────────────────
// Hydrostatic: 1 inch H₂O ≈ 0.249 kPa
float waterLevelIn() {
  float inches = (pressureKpa / 0.249f) - cfg.sensor_offset_in;
  return constrain(inches, 0.0f, cfg.height_in);
}

// ── MQTT publish ──────────────────────────────────────────────────────────────
void publishConfig() {
  char buf[512];
  snprintf(buf, sizeof(buf),
    "{\"device_id\":\"%s\","
    "\"friendly_name\":\"%s\","
    "\"container_type\":\"%s\","
    "\"capacity_gal\":%.1f,"
    "\"height_in\":%.1f,"
    "\"sensor_offset_in\":%.2f,"
    "\"schedule_interval_h\":%.2f,"
    "\"schedule_duration_min\":%u,"
    "\"latitude\":%.4f,"
    "\"longitude\":%.4f}",
    DEVICE_ID.c_str(),
    cfg.friendly_name,
    cfg.container_type,
    cfg.capacity_gal,
    cfg.height_in,
    cfg.sensor_offset_in,
    cfg.schedule_interval_h,
    cfg.schedule_duration_min,
    cfg.latitude,
    cfg.longitude
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
  if (!on) pump_off_at_ms = 0;
  digitalWrite(RELAY_PIN, on ? RELAY_ON : RELAY_OFF);
  Serial.println("Pump: " + String(on ? "ON" : "OFF"));
  publishStatus();
}

// ── Schedule ──────────────────────────────────────────────────────────────────
void checkSchedule() {
  if (cfg.schedule_interval_h <= 0.0f || cfg.schedule_duration_min == 0) return;

  time_t now;
  time(&now);
  if (now < 1000000000UL) return;  // NTP not yet synced

  if (next_water_epoch == 0) {
    // First run — schedule first watering one interval from now
    next_water_epoch = (uint32_t)now + (uint32_t)(cfg.schedule_interval_h * 3600.0f);
    prefs.begin("schedule", false);
    prefs.putUInt("next_water", next_water_epoch);
    prefs.end();
    Serial.printf("Schedule: first watering at epoch %u\n", next_water_epoch);
    return;
  }

  if ((uint32_t)now >= next_water_epoch) {
    // Advance to next slot before acting so we never drift
    next_water_epoch += (uint32_t)(cfg.schedule_interval_h * 3600.0f);
    prefs.begin("schedule", false);
    prefs.putUInt("next_water", next_water_epoch);
    prefs.end();

    if (skip_next) {
      skip_next = false;
      Serial.println("Schedule: watering skipped (rain suppression)");
    } else if (!pumpState) {
      Serial.printf("Schedule: starting %u-minute watering\n", cfg.schedule_duration_min);
      setPump(true);
      pump_off_at_ms = millis() + ((uint32_t)cfg.schedule_duration_min * 60000UL);
    }
  }
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
    else if (message == "pump_skip") {
      skip_next = true;
      Serial.println("Next scheduled watering will be skipped");
    } else if (message.startsWith("pump_on_timed:")) {
      int minutes = message.substring(14).toInt();
      if (minutes > 0) {
        setPump(true);
        pump_off_at_ms = millis() + ((uint32_t)minutes * 60000UL);
        Serial.printf("Pump ON for %d minutes\n", minutes);
      }
    }
  } else if (topicStr == TOPIC_DISCOVER) {
    publishConfig();
  } else if (topicStr == TOPIC_CONFIG_SET) {
    JsonDocument doc;
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      if (doc["friendly_name"].is<const char*>())
        strlcpy(cfg.friendly_name,  doc["friendly_name"],  sizeof(cfg.friendly_name));
      if (doc["container_type"].is<const char*>())
        strlcpy(cfg.container_type, doc["container_type"], sizeof(cfg.container_type));
      if (!doc["capacity_gal"].isNull())           cfg.capacity_gal          = doc["capacity_gal"];
      if (!doc["height_in"].isNull())              cfg.height_in             = doc["height_in"];
      if (!doc["sensor_offset_in"].isNull())       cfg.sensor_offset_in      = doc["sensor_offset_in"];
      if (!doc["schedule_duration_min"].isNull())  cfg.schedule_duration_min = doc["schedule_duration_min"];
      if (!doc["latitude"].isNull())               cfg.latitude              = doc["latitude"];
      if (!doc["longitude"].isNull())              cfg.longitude             = doc["longitude"];

      if (!doc["schedule_interval_h"].isNull()) {
        cfg.schedule_interval_h = doc["schedule_interval_h"];
        // Reset next watering so it recalculates from now
        next_water_epoch = 0;
        prefs.begin("schedule", false);
        prefs.putUInt("next_water", 0);
        prefs.end();
      }

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
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

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

  // Timed pump auto-off
  if (pump_off_at_ms != 0 && millis() >= pump_off_at_ms) {
    Serial.println("Timed pump shutoff");
    setPump(false);
  }

  // Schedule check (every 60 s is more than precise enough)
  static unsigned long lastScheduleCheck = 0;
  if (millis() - lastScheduleCheck >= 60000) {
    lastScheduleCheck = millis();
    checkSchedule();
  }

  static unsigned long lastStatus = 0;
  if (millis() - lastStatus > 30000) {
    publishStatus();
    lastStatus = millis();
  }
}

// config_tool/main.cpp — Fallback device configuration writer (flash-based)
//
// Prefer the in-app Edit button — it writes config over MQTT without reflashing.
// Use this only when the device can't reach MQTT (e.g. initial WiFi setup).
//
// 1. Edit the values below for this specific device
// 2. Flash with: pio run -e configure -t upload
// 3. Open serial monitor to confirm, then re-flash the main firmware:
//    pio run -e esp32dev -t upload

#include <Arduino.h>
#include <Preferences.h>

// ── Edit these before flashing ────────────────────────────────────────────────
const char*  FRIENDLY_NAME    = "Rain Barrel";  // shown in the app
const char*  CONTAINER_TYPE   = "barrel";        // barrel | tote | tank
const float  CAPACITY_GAL     = 55.0f;           // total capacity in gallons
const float  HEIGHT_IN        = 33.5f;           // interior height in inches
const float  SENSOR_OFFSET_IN = 0.0f;            // inches from sensor face to 0-fill line
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Device Config Writer ===");

  Preferences prefs;
  prefs.begin("device-cfg", false);  // false = read/write
  prefs.putString("name",      FRIENDLY_NAME);
  prefs.putString("type",      CONTAINER_TYPE);
  prefs.putFloat ("cap_gal",   CAPACITY_GAL);
  prefs.putFloat ("height_in", HEIGHT_IN);
  prefs.putFloat ("offset_in", SENSOR_OFFSET_IN);
  prefs.end();

  Serial.println("Config written to NVS:");
  Serial.printf("  friendly_name:    %s\n", FRIENDLY_NAME);
  Serial.printf("  container_type:   %s\n", CONTAINER_TYPE);
  Serial.printf("  capacity_gal:     %.1f\n", CAPACITY_GAL);
  Serial.printf("  height_in:        %.1f\"\n", HEIGHT_IN);
  Serial.printf("  sensor_offset_in: %.2f\"\n", SENSOR_OFFSET_IN);
  Serial.println("\nDone. Re-flash the main firmware now.");
}

void loop() {}

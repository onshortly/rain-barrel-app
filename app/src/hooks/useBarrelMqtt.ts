// src/hooks/useBarrelMqtt.ts
// Single import point — swap between real and mock MQTT via env var.
//
// In .env:
//   VITE_MOCK_MQTT=true   → uses simulated ESP32
//   VITE_MOCK_MQTT=false  → uses real MQTT broker (default)

import { useMqtt } from "./useMqtt";
import { useMqttMock } from "./useMqttMock";

const isMock = import.meta.env.VITE_MOCK_MQTT === "true";

export const useBarrelMqtt = isMock ? useMqttMock : useMqtt;

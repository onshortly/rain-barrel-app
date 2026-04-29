import { useEffect, useRef, useState, useCallback } from "react";
import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import type { DeviceConfig, BarrelStatus, DiscoveredDevice } from "../consts/rainBarrels";

const MQTT_CONFIG = {
  url:      import.meta.env.VITE_MQTT_URL,
  username: import.meta.env.VITE_MQTT_USERNAME,
  password: import.meta.env.VITE_MQTT_PASSWORD,
};

const DISCOVERY_TIMEOUT_MS = 4000;

export function useMqtt() {
  const clientRef = useRef<MqttClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [devices, setDevices] = useState<Map<string, DiscoveredDevice>>(new Map());
  const discoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateDevice = useCallback((id: string, patch: Partial<DiscoveredDevice>) => {
    setDevices(prev => {
      const next = new Map(prev);
      const existing = next.get(id) ?? { config: null!, status: null, online: false };
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }, []);

  useEffect(() => {
    const client = mqtt.connect(MQTT_CONFIG.url, {
      username: MQTT_CONFIG.username,
      password: MQTT_CONFIG.password,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 5000,
    });

    clientRef.current = client;

    client.on("connect", () => {
      console.log("[MQTT] Connected");
      setConnected(true);
      setDiscovering(true);

      client.subscribe("barrel/+/config", { qos: 1 });
      client.subscribe("barrel/+/status", { qos: 1 });
      client.subscribe("barrel/+/lwt",    { qos: 1 });
      client.publish("barrel/discover", "", { qos: 1 });

      discoveryTimer.current = setTimeout(
        () => setDiscovering(false),
        DISCOVERY_TIMEOUT_MS
      );
    });

    client.on("close", () => {
      console.log("[MQTT] Closed");
      setConnected(false);
    });

    client.on("message", (topic, payload) => {
      // topic format: barrel/{device_id}/{segment}
      const parts = topic.split("/");
      if (parts.length !== 3 || parts[0] !== "barrel") return;
      const [, deviceId, segment] = parts;

      try {
        const data = JSON.parse(payload.toString());
        if (segment === "config") {
          updateDevice(deviceId, { config: data as DeviceConfig });
        } else if (segment === "status") {
          updateDevice(deviceId, { status: data as BarrelStatus });
        } else if (segment === "lwt") {
          updateDevice(deviceId, { online: data.online ?? false });
        }
      } catch (err) {
        console.error("[MQTT] Failed to parse message:", err);
      }
    });

    return () => {
      client.end();
      if (discoveryTimer.current) clearTimeout(discoveryTimer.current);
    };
  }, [updateDevice]);

  const sendCommand = useCallback((deviceId: string, command: "pump_on" | "pump_off") => {
    if (!clientRef.current?.connected) return;
    clientRef.current.publish(`barrel/${deviceId}/command`, command, { qos: 1 });
    console.log(`[MQTT] ${deviceId} → ${command}`);
  }, []);

  const sendConfig = useCallback((deviceId: string, config: Partial<DeviceConfig>) => {
    if (!clientRef.current?.connected) return;
    clientRef.current.publish(
      `barrel/${deviceId}/config/set`,
      JSON.stringify(config),
      { qos: 1 }
    );
    console.log(`[MQTT] ${deviceId} config/set →`, config);
  }, []);

  return { devices, connected, discovering, sendCommand, sendConfig };
}

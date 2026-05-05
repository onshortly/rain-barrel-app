import { useState, useCallback, useEffect, useRef } from "react";
import type { DiscoveredDevice, BarrelStatus } from "../consts/rainBarrels";

const TICK_MS = 1000;
// Liters of water per inch of height per gallon of capacity
const L_PER_GAL = 3.785;

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

const MOCK_INITIAL: DiscoveredDevice[] = [
  {
    config: {
      device_id: "aabbccddeef0",
      friendly_name: "Back Garden Barrel",
      container_type: "barrel",
      capacity_gal: 55,
      height_in: 33.5,
      sensor_offset_in: 0,
      schedule_interval_h: 0,
      schedule_duration_min: 30,
      latitude: 0,
      longitude: 0,
    },
    status: {
      pump: false,
      water_level_in: 33.5 * 0.75,
      pressure_kpa: 33.5 * 0.75 * 0.249,
      flow_lpm: 0,
      total_L: 0,
      uptime: 0,
      rssi: -52,
    },
    online: true,
  },
  {
    config: {
      device_id: "aabbccddeef1",
      friendly_name: "Front Yard Tote",
      container_type: "tote",
      capacity_gal: 275,
      height_in: 46,
      sensor_offset_in: 0,
      schedule_interval_h: 0,
      schedule_duration_min: 30,
      latitude: 0,
      longitude: 0,
    },
    status: {
      pump: false,
      water_level_in: 46 * 0.4,
      pressure_kpa: 46 * 0.4 * 0.249,
      flow_lpm: 0,
      total_L: 0,
      uptime: 0,
      rssi: -61,
    },
    online: true,
  },
];

export function useMqttMock() {
  const [connected, setConnected] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [devices, setDevices] = useState<Map<string, DiscoveredDevice>>(new Map());
  // Mutable ref so tick closure always sees current state without re-subscribing
  const stateRef = useRef<Map<string, DiscoveredDevice>>(new Map());

  // Simulate connect + discovery
  useEffect(() => {
    const connectTimer = setTimeout(() => {
      setConnected(true);
      setDiscovering(true);
    }, 300);

    const discoverTimer = setTimeout(() => {
      const initial = new Map(
        MOCK_INITIAL.map(d => [d.config.device_id, structuredClone(d)])
      );
      stateRef.current = initial;
      setDevices(new Map(initial));
      setDiscovering(false);
    }, 1200);

    return () => {
      clearTimeout(connectTimer);
      clearTimeout(discoverTimer);
    };
  }, []);

  // Sensor tick
  useEffect(() => {
    const interval = setInterval(() => {
      const next = new Map<string, DiscoveredDevice>();

      for (const [id, device] of stateRef.current) {
        if (!device.status) { next.set(id, device); continue; }

        const cfg = device.config;
        const s: BarrelStatus = { ...device.status };
        const litersPerInch = (cfg.capacity_gal * L_PER_GAL) / cfg.height_in;

        s.uptime += 1;
        s.rssi = Math.round(Math.min(-30, Math.max(-80, s.rssi + randomBetween(-2, 2))));

        if (s.pump) {
          const drainLpm = 4.5;
          s.flow_lpm = drainLpm;
          s.total_L += drainLpm / 60;
          s.water_level_in = Math.max(0, s.water_level_in - (drainLpm / 60) / litersPerInch);
          s.pressure_kpa = s.water_level_in * 0.249;
          if (s.water_level_in <= 0) { s.pump = false; s.flow_lpm = 0; }
        } else {
          s.flow_lpm = 0;
          if (s.water_level_in < cfg.height_in) {
            s.water_level_in = Math.min(cfg.height_in, s.water_level_in + 0.008);
            s.pressure_kpa = s.water_level_in * 0.249;
          }
        }

        next.set(id, { ...device, status: s });
      }

      stateRef.current = next;
      setDevices(new Map(next));
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  const sendCommand = useCallback((deviceId: string, command: "pump_on" | "pump_off") => {
    console.log(`[MOCK MQTT] ${deviceId} → ${command}`);
    const latency = randomBetween(200, 800);
    setTimeout(() => {
      const device = stateRef.current.get(deviceId);
      if (!device?.status) return;
      const s: BarrelStatus = { ...device.status, pump: command === "pump_on" };
      if (!s.pump) s.flow_lpm = 0;
      const updated: DiscoveredDevice = { ...device, status: s };
      stateRef.current = new Map(stateRef.current).set(deviceId, updated);
      setDevices(prev => new Map(prev).set(deviceId, updated));
      console.log(`[MOCK MQTT] ${deviceId} confirmed after ${Math.round(latency)}ms`);
    }, latency);
  }, []);

  const sendConfig = useCallback((deviceId: string, config: Partial<import("../consts/rainBarrels").DeviceConfig>) => {
    console.log(`[MOCK MQTT] ${deviceId} config/set →`, config);
    // Simulate firmware echo: update config and re-broadcast retained config
    setTimeout(() => {
      const device = stateRef.current.get(deviceId);
      if (!device) return;
      const updated: DiscoveredDevice = {
        ...device,
        config: { ...device.config, ...config },
      };
      stateRef.current = new Map(stateRef.current).set(deviceId, updated);
      setDevices(prev => new Map(prev).set(deviceId, updated));
    }, 300);
  }, []);

  return { devices, connected, discovering, sendCommand, sendConfig };
}

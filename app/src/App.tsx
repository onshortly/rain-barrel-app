import { useState } from "react";
import { useRainBarrel } from "./hooks/useRainBarrel";
import { FillMeter } from "./components/FillMeter";
import { FlowTicker } from "./components/FlowTicker";
import type {
  DiscoveredDevice,
  DeviceConfig,
  ContainerType,
} from "./consts/rainBarrels";

function App() {
  const { devices, connected, discovering, sendCommand, sendConfig } =
    useRainBarrel();
  const deviceList = Array.from(devices.values()).filter((d) => d.config);

  return (
    <div
      style={{
        padding: 32,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Rain Barrel Controller</h1>
        <StatusDot label="MQTT" active={connected} />
      </div>

      {!connected && (
        <p style={{ color: "#94a3b8", fontSize: 14 }}>
          Connecting to broker...
        </p>
      )}

      {connected && discovering && (
        <p style={{ color: "#94a3b8", fontSize: 14 }}>
          Scanning for devices...
        </p>
      )}

      {connected && !discovering && deviceList.length === 0 && (
        <p style={{ color: "#f59e0b", fontSize: 14 }}>
          No devices found. Make sure your barrel controller is powered on and
          connected.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {deviceList.map((device) => (
          <DeviceCard
            key={device.config.device_id}
            device={device}
            onCommand={(cmd) => sendCommand(device.config.device_id, cmd)}
            onSaveConfig={(cfg) => sendConfig(device.config.device_id, cfg)}
          />
        ))}
      </div>
    </div>
  );
}

function DeviceCard({
  device,
  onCommand,
  onSaveConfig,
}: {
  device: DiscoveredDevice;
  onCommand: (cmd: "pump_on" | "pump_off") => void;
  onSaveConfig: (cfg: Partial<DeviceConfig>) => void;
}) {
  const { config, status, online } = device;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DeviceConfig>(config);
  const [intervalUnit, setIntervalUnit] = useState<"hours" | "days">(
    config.schedule_interval_h >= 24 ? "days" : "hours",
  );

  const isOpen = status?.pump ?? false;
  const fillPct = status
    ? Math.min(
        100,
        Math.max(0, (status.water_level_in / config.height_in) * 100),
      )
    : 0;
  const currentGal = (fillPct / 100) * config.capacity_gal;

  const startEdit = () => {
    setDraft(config);
    setIntervalUnit(config.schedule_interval_h >= 24 ? "days" : "hours");
    setEditing(true);
  };

  const saveEdit = () => {
    onSaveConfig(draft);
    setEditing(false);
  };

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {config.friendly_name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#64748b",
              textTransform: "capitalize",
              marginTop: 2,
            }}
          >
            {config.container_type} · {config.capacity_gal} gal
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot label={online ? "Online" : "Offline"} active={online} />
          {!editing && (
            <button onClick={startEdit} style={editBtnStyle}>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            background: "#f8fafc",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Field label="Name">
            <input
              style={inputStyle}
              value={draft.friendly_name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, friendly_name: e.target.value }))
              }
            />
          </Field>
          <Field label="Type">
            <select
              style={inputStyle}
              value={draft.container_type}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  container_type: e.target.value as ContainerType,
                }))
              }
            >
              <option value="barrel">Barrel</option>
              <option value="tote">Tote</option>
              <option value="tank">Tank</option>
            </select>
          </Field>
          <Field label="Capacity (gal)">
            <input
              style={inputStyle}
              type="number"
              min={1}
              step={1}
              value={draft.capacity_gal}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  capacity_gal: parseFloat(e.target.value) || 0,
                }))
              }
            />
          </Field>
          <Field label="Interior height (in)">
            <input
              style={inputStyle}
              type="number"
              min={1}
              step={0.5}
              value={draft.height_in}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  height_in: parseFloat(e.target.value) || 0,
                }))
              }
            />
          </Field>
          <Field label="Sensor offset (in)">
            <input
              style={inputStyle}
              type="number"
              min={0}
              step={0.25}
              value={draft.sensor_offset_in}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  sensor_offset_in: parseFloat(e.target.value) || 0,
                }))
              }
            />
          </Field>

          {/* Schedule */}
          <div
            style={{
              borderTop: "1px solid #e2e8f0",
              marginTop: 4,
              paddingTop: 10,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Watering Schedule
            </span>
          </div>
          <Field label="Water every">
            <input
              style={{ ...inputStyle, flex: "0 0 60px", width: 60 }}
              type="number"
              min={0}
              step={1}
              value={
                intervalUnit === "days"
                  ? Math.round(draft.schedule_interval_h / 24) || 0
                  : draft.schedule_interval_h
              }
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                setDraft((d) => ({
                  ...d,
                  schedule_interval_h:
                    intervalUnit === "days" ? val * 24 : val,
                }));
              }}
            />
            <select
              style={{ ...inputStyle, flex: "0 0 auto" }}
              value={intervalUnit}
              onChange={(e) =>
                setIntervalUnit(e.target.value as "hours" | "days")
              }
            >
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
              0 = off
            </span>
          </Field>
          {draft.schedule_interval_h > 0 && (
            <>
              <Field label="Duration (min)">
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  step={1}
                  value={draft.schedule_duration_min}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      schedule_duration_min: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </Field>
              <Field label="Latitude">
                <input
                  style={inputStyle}
                  type="number"
                  step={0.0001}
                  value={draft.latitude || ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      latitude: parseFloat(e.target.value) || 0,
                    }))
                  }
                  placeholder="e.g. 37.7749"
                />
              </Field>
              <Field label="Longitude">
                <input
                  style={inputStyle}
                  type="number"
                  step={0.0001}
                  value={draft.longitude || ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      longitude: parseFloat(e.target.value) || 0,
                    }))
                  }
                  placeholder="e.g. -122.4194"
                />
              </Field>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={saveEdit} style={saveBtnStyle}>
              Save
            </button>
            <button onClick={() => setEditing(false)} style={cancelBtnStyle}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <FillMeter
        fillPct={fillPct}
        currentGal={currentGal}
        maxGal={config.capacity_gal}
      />
      <FlowTicker flowLpm={status?.flow_lpm ?? 0} />

      <button
        onClick={() => onCommand(isOpen ? "pump_off" : "pump_on")}
        disabled={!online}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "12px 20px",
          fontSize: 16,
          fontWeight: 600,
          border: "none",
          borderRadius: 8,
          cursor: online ? "pointer" : "not-allowed",
          background: isOpen ? "#22c55e" : "#334155",
          color: "#fff",
          opacity: online ? 1 : 0.5,
          transition: "background 0.2s",
        }}
      >
        {isOpen ? "Pump ON — Tap to stop" : "Pump OFF — Tap to start"}
      </button>

      {status && (
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: "#94a3b8",
            display: "flex",
            gap: 16,
          }}
        >
          <span>Uptime: {formatUptime(status.uptime)}</span>
          <span>WiFi: {status.rssi} dBm</span>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: 12,
          color: "#64748b",
          width: 130,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: active ? "#22c55e" : "#94a3b8",
          transition: "background 0.2s",
        }}
      />
      <span style={{ fontSize: 13, color: "#64748b" }}>{label}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  fontSize: 13,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  background: "#fff",
  width: "100%",
};

const editBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  color: "#475569",
};

const saveBtnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 16px",
  border: "none",
  borderRadius: 6,
  background: "#3b82f6",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const cancelBtnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 16px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  background: "#fff",
  color: "#475569",
  cursor: "pointer",
};

export default App;

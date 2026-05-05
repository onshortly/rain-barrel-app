import mqtt from "mqtt";

interface Env {
  MQTT_BROKER: string;
  MQTT_USER: string;
  MQTT_PASS: string;
  RAIN_PROBABILITY_THRESHOLD?: string;  // default "50"
}

interface DeviceConfig {
  device_id: string;
  schedule_interval_h: number;
  schedule_duration_min: number;
  latitude: number;
  longitude: number;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRainCheck(env));
  },
};

async function runRainCheck(env: Env) {
  const threshold = parseInt(env.RAIN_PROBABILITY_THRESHOLD ?? "50", 10);
  const devices = await discoverDevices(env);
  console.log(`Discovered ${devices.length} device(s)`);

  for (const device of devices) {
    if (device.schedule_interval_h <= 0 || device.schedule_duration_min === 0) continue;
    if (!device.latitude || !device.longitude) continue;

    const willRain = await checkRainForecast(
      device.latitude,
      device.longitude,
      device.schedule_interval_h,
      threshold,
    );

    if (willRain) {
      console.log(`Rain expected for ${device.device_id} — sending pump_skip`);
      await publishCommand(env, device.device_id, "pump_skip");
    } else {
      console.log(`No rain expected for ${device.device_id}`);
    }
  }
}

function discoverDevices(env: Env): Promise<DeviceConfig[]> {
  return new Promise((resolve) => {
    const devices: DeviceConfig[] = [];

    const client = mqtt.connect(env.MQTT_BROKER, {
      username: env.MQTT_USER,
      password: env.MQTT_PASS,
      clientId: `worker-discover-${Math.random().toString(36).slice(2, 10)}`,
    });

    client.on("connect", () => {
      client.subscribe("barrel/+/config", () => {
        // Retained config messages arrive immediately after subscribe
        client.publish("barrel/discover", "");
      });
    });

    client.on("message", (topic, message) => {
      if (/^barrel\/[^/]+\/config$/.test(topic)) {
        try {
          devices.push(JSON.parse(message.toString()) as DeviceConfig);
        } catch {
          // ignore malformed payload
        }
      }
    });

    client.on("error", (err) => {
      console.error("MQTT discovery error:", err.message);
    });

    // Retained messages arrive within milliseconds; 5 s is generous
    setTimeout(() => {
      client.end(true);
      resolve(devices);
    }, 5000);
  });
}

async function checkRainForecast(
  lat: number,
  lon: number,
  lookAheadHours: number,
  threshold: number,
): Promise<boolean> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation_probability&forecast_days=2&timezone=auto`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error("Open-Meteo fetch failed:", err);
    return false;  // fail open — don't suppress watering on network error
  }

  if (!res.ok) {
    console.error("Open-Meteo HTTP error:", res.status);
    return false;
  }

  const data = (await res.json()) as {
    hourly: { time: string[]; precipitation_probability: number[] };
  };

  const now = Date.now();
  const cutoffMs = now + Math.ceil(lookAheadHours) * 3600 * 1000;

  for (let i = 0; i < data.hourly.time.length; i++) {
    const t = new Date(data.hourly.time[i]).getTime();
    if (t >= now && t <= cutoffMs) {
      if (data.hourly.precipitation_probability[i] >= threshold) return true;
    }
  }

  return false;
}

function publishCommand(env: Env, deviceId: string, command: string): Promise<void> {
  return new Promise((resolve) => {
    const client = mqtt.connect(env.MQTT_BROKER, {
      username: env.MQTT_USER,
      password: env.MQTT_PASS,
      clientId: `worker-cmd-${Math.random().toString(36).slice(2, 10)}`,
    });

    client.on("connect", () => {
      client.publish(
        `barrel/${deviceId}/command`,
        command,
        { qos: 1 },
        () => {
          client.end(true);
          resolve();
        },
      );
    });

    client.on("error", (err) => {
      console.error("MQTT publish error:", err.message);
      client.end(true);
      resolve();
    });
  });
}

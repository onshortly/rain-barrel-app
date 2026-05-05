export type ContainerType = 'barrel' | 'tote' | 'tank';

export interface DeviceConfig {
  device_id: string;
  friendly_name: string;
  container_type: ContainerType;
  capacity_gal: number;
  height_in: number;
  sensor_offset_in: number;
  schedule_interval_h: number;    // 0 = disabled; stored in hours
  schedule_duration_min: number;
  latitude: number;
  longitude: number;
}

export interface BarrelStatus {
  pump: boolean;
  pressure_kpa: number;
  water_level_in: number;
  flow_lpm: number;
  total_L: number;
  uptime: number;
  rssi: number;
}

export interface DiscoveredDevice {
  config: DeviceConfig;
  status: BarrelStatus | null;
  online: boolean;
}

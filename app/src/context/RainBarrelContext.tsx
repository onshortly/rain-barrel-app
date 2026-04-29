import React, { createContext } from "react";
import { useBarrelMqtt } from "../hooks/useBarrelMqtt";
import type { DiscoveredDevice, DeviceConfig } from "../consts/rainBarrels";

export interface RainBarrelContextType {
  devices: Map<string, DiscoveredDevice>;
  connected: boolean;
  discovering: boolean;
  sendCommand: (deviceId: string, cmd: "pump_on" | "pump_off") => void;
  sendConfig: (deviceId: string, config: Partial<DeviceConfig>) => void;
}

export const RainBarrelContext = createContext<RainBarrelContextType | undefined>(undefined);

export const RainBarrelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { devices, connected, discovering, sendCommand, sendConfig } = useBarrelMqtt();

  return (
    <RainBarrelContext.Provider value={{ devices, connected, discovering, sendCommand, sendConfig }}>
      {children}
    </RainBarrelContext.Provider>
  );
};

import { useContext } from "react";
import {
  RainBarrelContext,
  type RainBarrelContextType,
} from "../context/RainBarrelContext";

export const useRainBarrel = (): RainBarrelContextType => {
  const context = useContext(RainBarrelContext);
  if (!context) {
    throw new Error("useRainBarrel must be used within RainBarrelProvider");
  }
  return context;
};

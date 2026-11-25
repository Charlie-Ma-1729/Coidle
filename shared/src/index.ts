export * from "./game/types";
export * from "./game/data";
export * from "./game/roles";
export * from "./game/commands";
export * from "./game/time";
export * from "./game/helpers";
export * from "./game/guests";
export * from "./game/regulars";
export * from "./game/promotions";
export * from "./game/supply";
export * from "./game/rivals";
export * from "./game/workshop";
export * from "./game/tax";
export * from "./game/tech";
export * from "./game/lease";
export * from "./game/expansion";
export * from "./game/world";
export * from "./game/meta";
export * from "./game/weather";

export interface HealthResponse {
  ok: true;
  name: string;
  time: string;
}

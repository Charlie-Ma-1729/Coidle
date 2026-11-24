export * from "./game/types";
export * from "./game/data";
export * from "./game/roles";
export * from "./game/commands";
export * from "./game/time";
export * from "./game/helpers";
export * from "./game/guests";
export * from "./game/regulars";

export interface HealthResponse {
  ok: true;
  name: string;
  time: string;
}

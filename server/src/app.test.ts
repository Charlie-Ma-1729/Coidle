import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("server", () => {
  it("responds to /api/health", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });
});

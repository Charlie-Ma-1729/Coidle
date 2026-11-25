import { afterEach, describe, expect, it, vi } from "vitest";
import { alreadyReloadedFor, applyUpdate, fetchRemoteBuild, isEditing, updateAvailable } from "./updater";

afterEach(() => {
  vi.unstubAllGlobals();
  updateAvailable.value = null;
});

describe("fetchRemoteBuild", () => {
  it("讀 /version.json 的 build，不走快取", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ build: "abc123" }) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRemoteBuild()).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledWith("/version.json", { cache: "no-store" });
  });

  it("讀不到、格式不對時回傳 null（不會誤判成有新版）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchRemoteBuild()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ build: 5 }) })));
    expect(await fetchRemoteBuild()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await fetchRemoteBuild()).toBeNull();
  });
});

describe("重新載入", () => {
  it("applyUpdate 會記下這一版並重新載入；同一版不會再自動載入", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    expect(alreadyReloadedFor("v2")).toBe(false);
    applyUpdate("v2");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(alreadyReloadedFor("v2")).toBe(true);
    expect(alreadyReloadedFor("v3")).toBe(false);
  });

  it("isEditing：打字欄位算、按鈕與勾選不算", () => {
    const mk = (tagName: string, type = "", isContentEditable = false) => ({ tagName, type, isContentEditable });
    vi.stubGlobal("document", { activeElement: mk("TEXTAREA") });
    expect(isEditing()).toBe(true);
    vi.stubGlobal("document", { activeElement: mk("INPUT", "text") });
    expect(isEditing()).toBe(true);
    vi.stubGlobal("document", { activeElement: mk("INPUT", "checkbox") });
    expect(isEditing()).toBe(false);
    vi.stubGlobal("document", { activeElement: mk("BUTTON") });
    expect(isEditing()).toBe(false);
    vi.stubGlobal("document", { activeElement: null });
    expect(isEditing()).toBe(false);
  });
});

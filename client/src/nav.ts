import { signal } from "@preact/signals";

export type Tab = "overview" | "floor" | "guests" | "reports" | "more";
export type MoreSub = "ops" | "team";

export const tab = signal<Tab>("overview");
export const moreSub = signal<MoreSub>("ops");

export function goTo(t: Tab, sub?: MoreSub): void {
  tab.value = t;
  if (sub) moreSub.value = sub;
}

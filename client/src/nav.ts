import { signal } from "@preact/signals";

export type Tab = "overview" | "floor" | "guests" | "workshop" | "more";
export type MoreSub = "ops" | "marketing" | "suppliers" | "rivals" | "leasing" | "tech" | "tax" | "reports" | "team";

export const tab = signal<Tab>("overview");
export const moreSub = signal<MoreSub>("ops");

export function goTo(t: Tab, sub?: MoreSub): void {
  tab.value = t;
  if (sub) moreSub.value = sub;
}

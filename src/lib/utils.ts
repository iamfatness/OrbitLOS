import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
export const money = (amount: number) => amount ? usd.format(amount) : "—";
export const compactMoney = (amount: number) => shortUsd.format(amount);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
export const stageDays = (since: string) => Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 86_400_000));
export const dateTime = (date: string) => new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
}).format(new Date(date));

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface Loan {
  id: string;
  friendName: string;
  amountPaise: number;
  dueDate: string;
  repaidAt: string | null;
  createdAt: string;
  hasReceipt: boolean;
  overdue: boolean;
}
export interface Summary {
  totalLentPaise: number;
  totalRepaidPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  entryCount: number;
  today: string;
  currency: string;
}
export interface User {
  id: string;
  phone: string;
}
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4100"
).replace(/\/$/, "");

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function request<T>(
  route: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (options.body && !(options.body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(`${API_URL}${route}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    const data = await response.json();
    if (!response.ok)
      throw new RequestError(
        data.error ?? "Request failed. Please try again.",
        response.status,
      );
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new Error(
      "Cannot reach the server. Check that the API is running and your device can reach its address.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveToken(token: string | null) {
  if (Platform.OS === "web") {
    if (token) sessionStorage.setItem("miniledger-session", token);
    else sessionStorage.removeItem("miniledger-session");
  } else if (token) await SecureStore.setItemAsync("miniledger-session", token);
  else await SecureStore.deleteItemAsync("miniledger-session");
}

export async function loadToken() {
  return Platform.OS === "web"
    ? sessionStorage.getItem("miniledger-session")
    : SecureStore.getItemAsync("miniledger-session");
}

export const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

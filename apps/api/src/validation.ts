import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Use a phone number with country code, such as +919876543210.",
  );
export const requestOtpSchema = z.object({ phone: phoneSchema });
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit OTP."),
});

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}

export const loanSchema = z.object({
  friendName: z.string().trim().min(1, "Enter your friend’s name.").max(80),
  amount: z
    .string()
    .trim()
    .regex(
      /^\d{1,7}(\.\d{1,2})?$/,
      "Enter a positive amount with up to two decimals.",
    )
    .transform((value) => {
      const [rupees, paise = ""] = value.split(".");
      return Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
    })
    .refine(
      (value) => value > 0 && value <= 100000000,
      "Amount must be between ₹0.01 and ₹10,00,000.",
    ),
  dueDate: z.string().refine(validDate, "Enter a valid date as YYYY-MM-DD."),
});

export function todayInZone(zone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Adapted from Delta-1/FLORALIS.PDV, app.js at 883512c3. Shared by browser and server.
export function parseTenderAmount(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : NaN;
  let text = String(value ?? "")
    .trim()
    .replace(/\s/g, "");
  if (!text || !/^[\d.,]+$/.test(text)) return NaN;
  const comma = text.lastIndexOf(","),
    dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (
      !/^\d{1,3}(?:\.\d{3})+,\d{0,2}$/.test(text) &&
      !/^\d{1,3}(?:,\d{3})+\.\d{0,2}$/.test(text)
    )
      return NaN;
    const decimal = comma > dot ? "," : ".",
      group = decimal === "," ? "." : ",";
    text = text.split(group).join("");
    if (text.split(decimal).length !== 2) return NaN;
    text = text.replace(decimal, ".");
  } else if (comma >= 0) {
    if (text.split(",").length !== 2) return NaN;
    text = text.replace(",", ".");
  }
  if (!/^\d*(?:\.\d{0,2})?$/.test(text) || !/[0-9]/.test(text)) return NaN;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : NaN;
}
export function cashTenderSummary(total, first, additional = "") {
  const amount = parseTenderAmount(first),
    extra =
      String(additional ?? "").trim() === ""
        ? 0
        : parseTenderAmount(additional),
    totalCents = Math.round(Number(total) * 100),
    receivedCents = Math.round(amount * 100) + Math.round(extra * 100),
    valid =
      Number.isSafeInteger(totalCents) &&
      Number.isSafeInteger(receivedCents) &&
      totalCents >= 0 &&
      Number.isFinite(amount) &&
      Number.isFinite(extra);
  return {
    valid,
    received: valid ? receivedCents / 100 : 0,
    total: totalCents / 100,
    change: valid ? Math.max(0, receivedCents - totalCents) / 100 : 0,
    remaining: valid
      ? Math.max(0, totalCents - receivedCents) / 100
      : totalCents / 100,
  };
}

export const currencies = ["BRL", "BOB", "USD", "EUR"];
export const cents = (n) => Math.round(Number(n) * 100);

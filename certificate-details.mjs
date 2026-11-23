// Extract printed certificate fields, independently of metadata match markers.
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function parseCertificateDetails(source) {
  const text = String(source ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const registrationNumber = /\bREG\s*\.\s*NO\s*\.?\s*[:：]\s*([A-Z]+\s*\d+)\b/i.exec(text)?.[1]
    ?.replace(/\s/g, "").toUpperCase() ?? "";
  const englishName = /\bThis\s+is\s+to\s+certify\s+that\s+(.+?)\s*,\s*a\s+citizen\s+of\b/i.exec(text)?.[1]?.trim() ?? "";
  const birth = /\bborn\s+on\s+([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})\b/i.exec(text);
  let birthday = "";
  if (birth) {
    const month = MONTHS.indexOf(birth[1].toLowerCase()) + 1;
    const day = Number(birth[2]);
    const year = Number(birth[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (month && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      birthday = `${birth[3]}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
    }
  }
  // Keep Novice distinct from Level: Novice 2 must never become Level 2.
  const award = /\bobtained\s+(Level|Novice)\s*([1-6])\b/i.exec(text);
  const level = award ? `${award[1].toLowerCase() === "novice" ? "Novice" : "Level"} ${award[2]}` : "";
  return { registrationNumber, englishName, birthday, level };
}

export async function extractCertificateDetails(pdf) {
  const pages = [];
  // Read text in page order and normalize PDF.js text runs before parsing.
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => typeof item.str === "string" ? item.str : "").join(" "));
  }
  return parseCertificateDetails(pages.join("\n"));
}

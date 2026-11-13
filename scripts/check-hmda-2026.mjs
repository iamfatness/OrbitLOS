import { createReadStream } from "node:fs";
import { extname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// Positions are one-based in the 2026 FIG, section 3.4, Tables 1 and 2.
const agencyCodes = new Set(["1", "2", "3", "5", "7", "9"]);
const integer = /^\d+$/;
const lei = /^[A-Z0-9]{20}$/;
const integerLarFields = [
  5, 6, 7, 8, 9, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 31, 32,
  33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 49, 50, 51, 52, 53, 54, 55, 56,
  58, 60, 61, 62, 63, 64, 66, 68, 69, 70, 71, 84, 85, 86, 87, 89, 90,
  91, 93, 94, 96, 97, 98, 99, 100, 102, 103, 104, 105, 106, 108, 109, 110,
];

function dateInYear(value) {
  if (!/^2026\d{4}$/.test(value)) return false;
  const iso = `2026-${value.slice(4, 6)}-${value.slice(6)}`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso;
}

export async function checkHmda2026(lines, period) {
  if (!["annual", "q1", "q2", "q3"].includes(period)) throw new Error("Choose annual, q1, q2 or q3.");
  const quarter = period === "annual" ? 4 : Number(period.slice(1));
  const lastMonth = quarter * 3;
  const issues = [];
  let issueCount = 0;
  let lineNumber = 0;
  let submissionLei;
  let declaredEntries;
  function issue(field, message) {
    issueCount++;
    if (issues.length < 100) issues.push({ line: lineNumber, field, message });
  }

  for await (const line of lines) {
    lineNumber++;
    const fields = line.split("|");
    const header = lineNumber === 1;
    const fieldCount = header ? 15 : 110;
    if (fields.length !== fieldCount) {
      issue(null, `Expected ${fieldCount} pipe-delimited fields.`);
      continue;
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/u.test(line))
      issue(null, "Remove invalid text or control characters.");
    for (const [index, value] of fields.entries()) {
      if (/^(?:"[^"]*"|'[^']*')$/.test(value)) issue(index + 1, "Remove enclosing quotes.");
    }
    if (header) {
      if (fields[0] !== "1") issue(1, "The first record identifier must be 1.");
      if (fields[2] !== "2026") issue(3, "Use reporting year 2026.");
      if (fields[3] !== String(quarter)) issue(4, "The quarter code does not match the selected period.");
      if (!agencyCodes.has(fields[11])) issue(12, "Use a valid federal agency code.");
      if (integer.test(fields[12]) && Number.isSafeInteger(Number(fields[12]))) declaredEntries = Number(fields[12]);
      else issue(13, "Use an integer entry count.");
      if (lei.test(fields[14])) submissionLei = fields[14];
      else issue(15, "Enter a 20-character uppercase alphanumeric LEI.");
      continue;
    }

    if (fields[0] !== "2") issue(1, "The loan/application record identifier must be 2.");
    if (!lei.test(fields[1]) || (submissionLei && fields[1] !== submissionLei))
      issue(2, "The record LEI must match the transmittal LEI.");
    if (!/^[A-Za-z0-9]{1,45}$/.test(fields[2])) issue(3, "Check the loan identifier format.");
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(fields[9])) issue(10, "Use an ordinary decimal dollar amount.");
    if (!/^[1-8]$/.test(fields[10])) issue(11, "Use an action taken code from 1 to 8.");
    if (!dateInYear(fields[11]) || Number(fields[11].slice(4, 6)) > lastMonth)
      issue(12, "Use a valid 2026 action date within the selected period, including permitted earlier quarters.");
    for (const position of integerLarFields) {
      const value = fields[position - 1];
      if (value !== "" && !integer.test(value)) issue(position, "Use an integer in this field.");
    }
  }

  const entries = Math.max(0, lineNumber - 1);
  const missingTransmittal = lineNumber === 0;
  lineNumber = 1;
  if (missingTransmittal) issue(null, "The transmittal record is missing.");
  if (declaredEntries !== undefined && declaredEntries !== entries)
    issue(13, "The transmittal count does not match the number of loan/application rows.");
  return { reportYear: 2026, period, entries, issueCount, issues };
}

async function main() {
  const [period, path, ...extra] = process.argv.slice(2);
  if (!path || extname(path).toLowerCase() !== ".txt" || extra.length || !["annual", "q1", "q2", "q3"].includes(period)) {
    process.stderr.write("Usage: node scripts/check-hmda-2026.mjs <annual|q1|q2|q3> <file.txt>\n");
    process.exitCode = 2;
    return;
  }
  try {
    const stream = createReadStream(path, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const result = await checkHmda2026(lines, period);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.issueCount) process.exitCode = 1;
  } catch {
    process.stderr.write("Could not read or check the local HMDA file.\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

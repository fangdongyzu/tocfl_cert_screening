import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { parseCertificateDetails, extractCertificateDetails } from "../certificate-details.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("../vendor/exceljs/exceljs.min.js");
const sample = `REG.NO.: TLR00000001
This is to certify that ALEX EXAMPLE, a citizen of Exampleland, born on February 1,
1997, passed and successfully obtained Level 2 for the Test of Chinese as a Foreign Language.`;
const expected = {
  registrationNumber: "TLR00000001", englishName: "ALEX EXAMPLE",
  birthday: "19970201", level: "Level 2",
};

test("extracts the four fields across line breaks", () => {
  assert.deepEqual(parseCertificateDetails(sample), expected);
});

test("validates calendar dates and does not confuse test date with birth date", () => {
  assert.equal(parseCertificateDetails(sample.replace("February 1", "February 30")).birthday, "");
  assert.equal(parseCertificateDetails(sample.replace("February 1", "February 29")).birthday, "");
  assert.equal(parseCertificateDetails(sample.replace("February 1,\n1997", "February 29, 2000")).birthday, "20000229");
  assert.equal(parseCertificateDetails("on April 18, 2026, obtained Level 2").birthday, "");
});

test("handles full-width punctuation, names, levels and empty scans", () => {
  assert.equal(parseCertificateDetails(sample.replace("REG.NO.:", "REG. NO.：")).registrationNumber, expected.registrationNumber);
  assert.equal(parseCertificateDetails(sample.replace("ALEX EXAMPLE", "ANNE-MARIE O'NEILL")).englishName, "ANNE-MARIE O'NEILL");
  assert.equal(parseCertificateDetails(sample.replace("Level 2", "Novice 2")).level, "Novice 2");
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.equal(parseCertificateDetails(sample.replace("Level 2", `Level ${level}`)).level, `Level ${level}`);
  }
  assert.deepEqual(parseCertificateDetails(""), { registrationNumber: "", englishName: "", birthday: "", level: "" });
});

function loadApp(pdf) {
  const element = () => ({ style: {}, append() {}, addEventListener() {},
    setAttribute() {}, insertAdjacentElement() {}, click() {}, remove() {} });
  let blob;
  const context = vm.createContext({
    extractCertificateDetails, parseCertificateDetails, Uint8Array, Date, Blob,
    atob, setTimeout: () => {},
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(pdf) }) },
    window: { ExcelJS, isSecureContext: false },
    document: { querySelector: element, createElement: element, body: element() },
    URL: { createObjectURL(value) { blob = value; return "blob:test"; }, revokeObjectURL() {} },
  });
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  vm.runInContext(source, context);
  return { context, getBlob: () => blob };
}

const metadata = { info: {
  Creator: "pdf-lib (https://github.com/Hopding/pdf-lib)",
  Producer: "pdf-lib (https://github.com/Hopding/pdf-lib)",
  Custom: { CategoryCode: "1.6", IssueCode: "4", VerifyCode: "1.1", VersionCode: "1",
    CertID: "A".repeat(64) + ":0", Other: JSON.stringify({ DDLanguage: "Chinese", DDRelease: "v2", Hash: "A".repeat(43) + "=" }) },
} };

test("PDF extraction and real XLSX export preserve values, dates and marker styling", async () => {
  let destroyed = false;
  const pdf = { numPages: 1, getMetadata: async () => metadata,
    getPage: async () => ({ getTextContent: async () => ({ items: sample.split(/\s+/).map(str => ({ str })) }) }),
    destroy: async () => { destroyed = true; } };
  const { context, getBlob } = loadApp(pdf);
  context.file = { name: "unrelated-filename.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(1) };
  const result = await vm.runInContext("inspectPdfMetadata(file)", context);
  assert.deepEqual(result.certificate, expected);
  assert.equal(result.overall, true);
  assert.equal(result.extractionError, "");
  assert.equal(destroyed, true);
  context.result = result;
  await vm.runInContext("state.results = [result]; downloadWorkbook()", context);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await getBlob().arrayBuffer());
  const sheet = workbook.getWorksheet("Metadata results");
  const headers = sheet.getRow(1).values;
  const cell = header => sheet.getRow(2).getCell(headers.indexOf(header));
  assert.equal(cell("REG.NO.:").value, expected.registrationNumber);
  assert.equal(cell("English name").value, expected.englishName);
  assert.equal(cell("Birthday (YYYYMMDD)").value.toISOString(), "1997-02-01T00:00:00.000Z");
  assert.equal(cell("Birthday (YYYYMMDD)").numFmt, "yyyymmdd");
  assert.equal(cell("Level").value, "Level 2");
  assert.equal(cell("Overall").value, "MATCH");
  assert.equal(cell("Other data").fill.fgColor.argb, "FFDFF4E6");
  assert.notEqual(cell("REG.NO.:").fill?.fgColor?.argb, "FFF9DEDD");
});

test("text extraction failure preserves successful metadata checks and destroys PDF", async () => {
  let destroyed = false;
  const pdf = { numPages: 1, getMetadata: async () => metadata,
    getPage: async () => { throw new Error("unreadable text"); },
    destroy: async () => { destroyed = true; } };
  const { context } = loadApp(pdf);
  context.file = { name: "scan.pdf", size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  const result = await vm.runInContext("inspectPdfMetadata(file)", context);
  assert.equal(result.overall, true);
  assert.match(result.extractionError, /Unable to read certificate text/);
  assert.equal(result.certificate.birthday, "");
  assert.equal(destroyed, true);
});

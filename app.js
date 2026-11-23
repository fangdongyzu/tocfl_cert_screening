import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";

const EXPECTED = Object.freeze({
  creator: "pdf-lib (https://github.com/Hopding/pdf-lib)",
  producer: "pdf-lib (https://github.com/Hopding/pdf-lib)",
  categoryCode: "1.6",
  issueCode: "4",
  verifyCode: "1.1",
  versionCode: "1",
  language: "Chinese",
  release: "v2",
});

const MARKERS = Object.freeze([
  ["creator", "Creator"],
  ["producer", "Producer"],
  ["category", "Category"],
  ["issue", "Issue"],
  ["verify", "Verify"],
  ["version", "Version"],
  ["certId", "Cert ID"],
  ["other", "Other data"],
]);

const state = {
  files: [],
  results: [],
  checking: false,
};

// A Windows short name cannot be converted back to its original long name.
// Users can supply the original name when the browser supplies a short name.
const fileNameOverrides = new WeakMap();

function getFileName(file) {
  return fileNameOverrides.get(file) ?? file.name;
}

function looksLikeShortName(name) {
  return /^[^\\/]{1,6}~[0-9]+(?:\.[^.]*)?$/i.test(name);
}

const elements = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  fileQueue: document.querySelector("#fileQueue"),
  queueList: document.querySelector("#queueList"),
  queueCount: document.querySelector("#queueCount"),
  queueSize: document.querySelector("#queueSize"),
  queueTemplate: document.querySelector("#queueItemTemplate"),
  clearButton: document.querySelector("#clearButton"),
  checkButton: document.querySelector("#checkButton"),
  checkButtonLabel: document.querySelector("#checkButtonLabel"),
  progress: document.querySelector("#progress"),
  progressBar: document.querySelector("#progressBar"),
  progressText: document.querySelector("#progressText"),
  resultsSection: document.querySelector("#resultsSection"),
  resultsSummary: document.querySelector("#resultsSummary"),
  resultsBody: document.querySelector("#resultsBody"),
  downloadButton: document.querySelector("#downloadButton"),
};

// Read actual directory entries instead of relying only on file-input names.
// This is optional: the original file input and drag-and-drop still work.
const folderControls = document.createElement("div");
folderControls.style.margin = "12px 0";
const folderButton = document.createElement("button");
folderButton.type = "button";
folderButton.textContent = "Select PDF folder";
folderButton.style.padding = "10px 16px";
const folderStatus = document.createElement("p");
folderStatus.setAttribute("role", "status");
folderStatus.style.margin = "8px 0";
folderControls.append(folderButton, folderStatus);
elements.dropZone.insertAdjacentElement("afterend", folderControls);
folderButton.addEventListener("click", selectPdfFolder);

const supportsFolderPicker = window.isSecureContext &&
  typeof window.showDirectoryPicker === "function";
if (!supportsFolderPicker) {
  folderButton.disabled = true;
  folderStatus.textContent = "Folder selection needs a supported browser such as Chrome on HTTPS or localhost.";
}

async function fileFromDirectoryEntry(entry, entryName = entry.name) {
  const file = await entry.getFile();
  // Prefer the directory entry's name, even if file.name is an 8.3 alias.
  fileNameOverrides.set(file, entryName);
  return file;
}

async function selectPdfFolder() {
  if (state.checking || folderButton.disabled) return;
  folderButton.disabled = true;
  try {
    const directory = await window.showDirectoryPicker({ mode: "read" });
    folderStatus.textContent = "Reading PDF filenames...";
    const incoming = [];
    let failed = 0;
    // Only read PDFs directly inside the selected folder.
    for await (const [entryName, entry] of directory.entries()) {
      if (entry.kind !== "file" || !/\.pdf$/i.test(entryName)) continue;
      try {
        incoming.push(await fileFromDirectoryEntry(entry, entryName));
      } catch {
        failed += 1;
      }
    }
    incoming.sort((a, b) => getFileName(a).localeCompare(getFileName(b)));
    if (state.checking) {
      folderStatus.textContent = "Checking is in progress. Select the folder again when it finishes.";
      return;
    }
    if (incoming.length) addFiles(incoming);
    folderStatus.textContent = incoming.length
      ? incoming.length + " PDFs read from folder entries. Check the filenames below before exporting."
      : "No readable PDFs found directly inside this folder.";
    if (failed) folderStatus.textContent += " Could not read " + failed + " PDF(s).";
    if (incoming.some(file => looksLikeShortName(getFileName(file)))) {
      folderStatus.textContent += " Some folder entries still have possible short names; their full names have not been recovered.";
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    folderStatus.textContent = "Could not open this folder: " + readableError(error);
  } finally {
    folderButton.disabled = !supportsFolderPicker;
  }
}

elements.fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer.files);
});

elements.clearButton.addEventListener("click", clearFiles);
elements.checkButton.addEventListener("click", checkAllFiles);
elements.downloadButton.addEventListener("click", downloadWorkbook);

function addFiles(fileList) {
  if (state.checking) return;

  const incoming = Array.from(fileList);
  const known = new Set(
    state.files.map((file) => `${getFileName(file)}:${file.size}:${file.lastModified}`),
  );

  incoming.forEach((file) => {
    const key = `${getFileName(file)}:${file.size}:${file.lastModified}`;
    if (!known.has(key)) {
      state.files.push(file);
      known.add(key);
    }
  });

  state.results = [];
  elements.resultsSection.hidden = true;
  renderQueue();
}

function clearFiles() {
  if (state.checking) return;
  state.files = [];
  state.results = [];
  elements.fileInput.value = "";
  elements.resultsSection.hidden = true;
  renderQueue();
}

function renderQueue() {
  elements.queueList.replaceChildren();

  state.files.forEach((file) => {
    const row = elements.queueTemplate.content.cloneNode(true);
    const nameElement = row.querySelector(".queue-file-name");
    const fullName = getFileName(file);
    nameElement.textContent = fullName;
    nameElement.title = fullName;
    Object.assign(nameElement.style, {
      whiteSpace: "normal",
      overflow: "visible",
      textOverflow: "clip",
      overflowWrap: "anywhere",
      minWidth: "0",
    });

    if (looksLikeShortName(fullName)) {
      const warning = document.createElement("small");
      warning.textContent = "Possible Windows short name. Try Select PDF folder above, or enter the full filename below.";
      warning.style.display = "block";
      const input = document.createElement("input");
      input.type = "text";
      input.value = fullName;
      input.setAttribute("aria-label", "Full filename including extension");
      input.style.width = "100%";
      input.style.boxSizing = "border-box";
      input.disabled = state.checking;
      input.addEventListener("change", () => {
        if (state.checking) {
          input.value = getFileName(file);
          return;
        }
        const enteredName = input.value.trim();
        if (!enteredName || /[\\/]/.test(enteredName)) {
          input.value = getFileName(file);
          return;
        }
        fileNameOverrides.set(file, enteredName);
        state.results = [];
        elements.resultsSection.hidden = true;
        renderQueue();
      });
      nameElement.append(warning, input);
    }
    row.querySelector(".queue-file-size").textContent = formatBytes(file.size);
    elements.queueList.append(row);
  });

  const count = state.files.length;
  const totalSize = state.files.reduce((sum, file) => sum + file.size, 0);
  elements.queueCount.textContent = `${count} ${count === 1 ? "file" : "files"} selected`;
  elements.queueSize.textContent = formatBytes(totalSize);
  elements.fileQueue.hidden = count === 0;
  elements.clearButton.hidden = count === 0;
  elements.checkButton.disabled = count === 0;
}

async function checkAllFiles() {
  if (state.checking || state.files.length === 0) return;

  state.checking = true;
  state.results = [];
  elements.checkButton.disabled = true;
  elements.clearButton.disabled = true;
  elements.progress.hidden = false;
  elements.progressBar.style.width = "0%";
  elements.checkButtonLabel.textContent = "Checking…";

  for (let index = 0; index < state.files.length; index += 1) {
    const file = state.files[index];
    elements.progressText.textContent = `Checking ${index + 1} of ${state.files.length}: ${getFileName(file)}`;

    try {
      state.results.push(await inspectPdfMetadata(file));
    } catch (error) {
      state.results.push(failedResult(file, error));
    }

    const percent = Math.round(((index + 1) / state.files.length) * 100);
    elements.progressBar.style.width = `${percent}%`;
    await nextPaint();
  }

  state.checking = false;
  elements.clearButton.disabled = false;
  elements.checkButton.disabled = false;
  elements.checkButtonLabel.textContent = "Check metadata";
  elements.progressText.textContent = `${state.files.length} ${state.files.length === 1 ? "file" : "files"} checked`;
  renderResults();
}

async function inspectPdfMetadata(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    stopAtErrors: true,
  });
  const pdf = await loadingTask.promise;

  try {
    const metadata = await pdf.getMetadata();
    const info = metadata.info ?? {};
    const custom = info.Custom ?? {};
    const value = (key) => stringifyMetadata(custom[key] ?? info[key] ?? "");

    const creator = value("Creator");
    const producer = value("Producer");
    const categoryCode = value("CategoryCode");
    const issueCode = value("IssueCode");
    const verifyCode = value("VerifyCode");
    const versionCode = value("VersionCode");
    const certId = value("CertID");
    const otherRaw = value("Other");
    const other = parseOther(otherRaw);

    const markers = {
      creator: creator === EXPECTED.creator,
      producer: producer === EXPECTED.producer,
      category: categoryCode === EXPECTED.categoryCode,
      issue: issueCode === EXPECTED.issueCode,
      verify: verifyCode === EXPECTED.verifyCode,
      version: versionCode === EXPECTED.versionCode,
      certId: validateCertId(certId),
      other:
        other.valid &&
        other.language === EXPECTED.language &&
        other.release === EXPECTED.release &&
        validateBase64(other.hash, 32),
    };

    return {
      fileName: getFileName(file),
      fileSize: file.size,
      overall: Object.values(markers).every(Boolean),
      markers,
      metadata: {
        pdfFormatVersion: value("PDFFormatVersion"),
        creator,
        producer,
        categoryCode,
        issueCode,
        verifyCode,
        versionCode,
        certId,
        language: other.language,
        release: other.release,
        embeddedHash: other.hash,
        creationDate: value("CreationDate"),
        modificationDate: value("ModDate"),
        pageCount: pdf.numPages,
      },
      error: "",
    };
  } finally {
    await pdf.destroy();
  }
}

function parseOther(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      valid: parsed !== null && typeof parsed === "object",
      language: stringifyMetadata(parsed.DDLanguage),
      release: stringifyMetadata(parsed.DDRelease),
      hash: stringifyMetadata(parsed.Hash),
    };
  } catch {
    return { valid: false, language: "", release: "", hash: "" };
  }
}

function validateCertId(value) {
  const match = /^([A-Za-z0-9+/]{64}):0$/.exec(value);
  return Boolean(match && validateBase64(match[1], 48));
}

function validateBase64(value, byteLength) {
  if (typeof value !== "string" || value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;

  try {
    return atob(value).length === byteLength;
  } catch {
    return false;
  }
}

function failedResult(file, error) {
  return {
    fileName: getFileName(file),
    fileSize: file.size,
    overall: false,
    markers: Object.fromEntries(MARKERS.map(([key]) => [key, false])),
    metadata: {
      pdfFormatVersion: "",
      creator: "",
      producer: "",
      categoryCode: "",
      issueCode: "",
      verifyCode: "",
      versionCode: "",
      certId: "",
      language: "",
      release: "",
      embeddedHash: "",
      creationDate: "",
      modificationDate: "",
      pageCount: "",
    },
    error: readableError(error),
  };
}

function renderResults() {
  elements.resultsBody.replaceChildren();

  state.results.forEach((result) => {
    const row = document.createElement("tr");
    const fileCell = document.createElement("td");
    fileCell.textContent = result.fileName;
    fileCell.title = result.error
      ? result.fileName + "\n" + result.error
      : result.fileName;
    Object.assign(fileCell.style, {
      whiteSpace: "normal",
      overflow: "visible",
      textOverflow: "clip",
      overflowWrap: "anywhere",
    });
    row.append(fileCell);
    row.append(markerCell(result.overall, true));

    MARKERS.forEach(([key]) => {
      row.append(markerCell(result.markers[key]));
    });

    elements.resultsBody.append(row);
  });

  const passed = state.results.filter((result) => result.overall).length;
  const failed = state.results.length - passed;
  elements.resultsSummary.textContent = `${passed} matched · ${failed} did not match · ${state.results.length} total`;
  elements.resultsSection.hidden = false;
  elements.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markerCell(passed, overall = false) {
  const cell = document.createElement("td");
  const label = passed ? "Match" : "Different";
  const icon = passed ? "✓" : "×";
  cell.className = `marker ${passed ? "pass" : "fail"}`;
  cell.innerHTML = `<span aria-label="${label}">${icon} ${overall ? label : passed ? "Yes" : "No"}</span>`;
  return cell;
}

async function downloadWorkbook() {
  if (state.results.length === 0) return;

  if (!window.ExcelJS) {
    window.alert("The XLSX library did not load. Check your internet connection and try again.");
    return;
  }

  elements.downloadButton.disabled = true;

  try {
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "Certificate Metadata Checker";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Metadata results", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    });

    sheet.columns = [
      { header: "File", key: "fileName", width: 70 },
      { header: "Overall", key: "overall", width: 14 },
      ...MARKERS.map(([key, label]) => ({ header: label, key, width: 14 })),
      { header: "PDF version", key: "pdfFormatVersion", width: 14 },
      { header: "Creator value", key: "creatorValue", width: 48 },
      { header: "Producer value", key: "producerValue", width: 48 },
      { header: "CategoryCode", key: "categoryCode", width: 15 },
      { header: "IssueCode", key: "issueCode", width: 13 },
      { header: "VerifyCode", key: "verifyCode", width: 13 },
      { header: "VersionCode", key: "versionCode", width: 14 },
      { header: "CertID", key: "certIdValue", width: 70 },
      { header: "DDLanguage", key: "language", width: 16 },
      { header: "DDRelease", key: "release", width: 14 },
      { header: "Embedded Hash", key: "embeddedHash", width: 48 },
      { header: "CreationDate (ignored)", key: "creationDate", width: 24 },
      { header: "ModDate (ignored)", key: "modificationDate", width: 24 },
      { header: "Pages (reported only)", key: "pageCount", width: 20 },
      { header: "Error", key: "error", width: 42 },
    ];

    state.results.forEach((result) => {
      sheet.addRow({
        fileName: result.fileName,
        overall: result.overall ? "MATCH" : "DIFFERENT",
        ...Object.fromEntries(
          MARKERS.map(([key]) => [key, result.markers[key] ? "MATCH" : "DIFFERENT"]),
        ),
        pdfFormatVersion: result.metadata.pdfFormatVersion,
        creatorValue: result.metadata.creator,
        producerValue: result.metadata.producer,
        categoryCode: result.metadata.categoryCode,
        issueCode: result.metadata.issueCode,
        verifyCode: result.metadata.verifyCode,
        versionCode: result.metadata.versionCode,
        certIdValue: result.metadata.certId,
        language: result.metadata.language,
        release: result.metadata.release,
        embeddedHash: result.metadata.embeddedHash,
        creationDate: result.metadata.creationDate,
        modificationDate: result.metadata.modificationDate,
        pageCount: result.metadata.pageCount,
        error: result.error,
      });
    });

    styleWorkbook(sheet);

    const output = await workbook.xlsx.writeBuffer();
    const blob = new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `certificate-metadata-results-${dateStamp()}.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    elements.downloadButton.disabled = false;
  }
}

function styleWorkbook(sheet) {
  const dark = "FF163F31";
  const white = "FFFFFFFF";
  const passFill = "FFDFF4E6";
  const passInk = "FF17643B";
  const failFill = "FFF9DEDD";
  const failInk = "FF9F302D";
  const borderColor = "FFDCE2DE";
  const markerEndColumn = 2 + MARKERS.length;

  const header = sheet.getRow(1);
  header.height = 28;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark } };
    cell.font = { color: { argb: white }, bold: true, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    // Allow extra height for long filenames, including CJK characters.
    const name = String(row.getCell(1).value ?? "");
    const nameWidth = Array.from(name).reduce(
      (sum, character) => sum + (character.codePointAt(0) > 255 ? 2 : 1),
      0,
    );
    row.height = Math.min(409, Math.max(25, Math.ceil(nameWidth / 60) * 16 + 10));
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: borderColor } },
        right: { style: "thin", color: { argb: borderColor } },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: columnNumber === 1 ? "left" : "center",
        wrapText: columnNumber === 1,
      };

      if (columnNumber >= 2 && columnNumber <= markerEndColumn) {
        const passed = cell.value === "MATCH";
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: passed ? passFill : failFill },
        };
        cell.font = {
          bold: true,
          color: { argb: passed ? passInk : failInk },
        };
      }
    });
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sheet.rowCount, column: sheet.columnCount },
  };
}

function readableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Unable to read PDF metadata";
}

function stringifyMetadata(value) {
  return value === undefined || value === null ? "" : String(value);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

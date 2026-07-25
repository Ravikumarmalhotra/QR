// ============================================================
// LIVE CLOCK
// ============================================================
(function initLiveClock() {
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const clockEl = document.getElementById('liveClockText');
  function pad(n) { return n.toString().padStart(2, '0'); }
  function updateClock() {
    const now = new Date();
    const dayStr = dayNames[now.getDay()];
    const dateStr = pad(now.getDate());
    const monthStr = monthNames[now.getMonth()];
    const yearStr = now.getFullYear().toString().slice(-2);
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    if (clockEl) clockEl.innerText = `${dayStr} ${dateStr} ${monthStr} ${yearStr} ${timeStr}`;
  }
  updateClock();
  setInterval(updateClock, 1000);
})();

// ============================================================
// CONFIGURATION
// ============================================================
const SPREADSHEET_ID = "1Jid66wBQ1ktKoysqpoCF1sIKengpsHq8CQKW9euMWh0";
const API_KEY = "AIzaSyAjBceUqA-G1ueMCsqevOiPEhb2Nk-pOhI";
const ROWS_PER_PAGE = 12;
const CHECKSHEET_SHEET_NAME = "Checksheet_ALL"; // NEW: single global checksheet index sheet

const groupSheetSuffixMap = {
  "01": "HT", "02": "LT", "03": "Pump", "04": "DG",
  "05": "Third_rail", "06": "Lift_&_Escalator", "07": "Fire", "08": "Split_&_HVAC"
};

function getSheetNamesForAsset(assetId) {
  const groupCode = assetId.substring(3, 5);
  const suffix = groupSheetSuffixMap[groupCode];
  if (!suffix) return null;
  return {
    suffix: suffix,
    maintenance: `Maintenance_${suffix}`,
    failure: `Failure_${suffix}`,
    specifications: `Specifications_${suffix}`
  };
}

// ============================================================
// FREQUENCY OF MAINTENANCE MAP
// ============================================================
function getFrequencyOfMaintenance(id) {
  const group = id.substring(3, 5);
  const code4 = id.substring(3, 7);
  const codeNum = parseInt(code4, 10);
  if (group === "01") { // HT
    if (codeNum >= 101 && codeNum <= 115) return "Yearly";
    if (codeNum === 116) return "Monthly";
  }
  return "Not Defined";
}

function addInterval(date, frequency) {
  const d = new Date(date.getTime());
  switch (frequency) {
    case 'Yearly': d.setFullYear(d.getFullYear() + 1); break;
    case 'Half-Yearly': d.setMonth(d.getMonth() + 6); break;
    case 'Quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'Monthly': d.setMonth(d.getMonth() + 1); break;
    case 'Fortnightly': d.setDate(d.getDate() + 14); break;
    case 'Weekly': d.setDate(d.getDate() + 7); break;
    default: return null;
  }
  return d;
}

function formatDateDDMMYY(d) {
  if (!d) return "";
  const dd = d.getDate().toString().padStart(2,'0');
  const mm = (d.getMonth()+1).toString().padStart(2,'0');
  const yy = d.getFullYear().toString().slice(-2);
  return `${dd}-${mm}-${yy}`;
}


function isKnownValidAssetId(id) {
  const groupCode = id.substring(3, 5);
  const validSet = validAssetIdsByGroup[groupCode];
  if (!validSet) return true;
  return validSet.has(id);
}

const state = {
  maintenance: { rows: [], meta: null, filter: 'all', pages: {}, expandedYears: null },
  failure: { rows: [], meta: null, filter: 'all', pages: {}, expandedYears: null }
};

// NEW: track currently loaded asset + More-tab expand state
let currentAssetId = null;
const moreState = { medium: {}, low: {} };

window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const idFromUrl = urlParams.get('id');

  if (idFromUrl && idFromUrl.length === 9 && !isNaN(idFromUrl)) {
    document.getElementById('inputContainer').style.display = "none";
    document.getElementById('manualAssetId').value = idFromUrl;
    processAssetPipelines(idFromUrl);
  } else {
    document.getElementById('inputContainer').style.display = "block";
  }
});

function handleManualSearch() {
  let enteredId = document.getElementById('manualAssetId').value.trim();
  if(enteredId.length !== 9 || isNaN(enteredId)) {
    alert("Invalid format. Please enter a valid 9-digit asset ID.");
    return;
  }
  document.getElementById('inputContainer').style.display = "none";
  processAssetPipelines(enteredId);
}

function getAssetMetadata(id) {
  let parsedStation = id.substring(0,3);
  let parsedGroup = id.substring(3,5);
  let parsedSubGroup = id.substring(5,7);
  let parsedAssetNo = id.substring(7,9);

  let stationName = stationMap[parsedStation] || null;
  let groupName = groupMap[parsedGroup] || null;

  let subGroupName = null;
  if (subGroupMap[parsedGroup]) {
    subGroupName = subGroupMap[parsedGroup][parsedSubGroup] || null;
  }

  let equipmentName = null;
  if (equipmentMap[parsedGroup] && equipmentMap[parsedGroup][parsedSubGroup]) {
    equipmentName = equipmentMap[parsedGroup][parsedSubGroup][parsedAssetNo] || null;
  }

  return { station: stationName, group: groupName, subGroup: subGroupName, equipmentName: equipmentName };
}

function parseDDMMYY(dateStr) {
  if (!dateStr) return null;
  const cleaned = dateStr.toString().trim();
  const parts = cleaned.split(/[-\/]/);
  if (parts.length !== 3) return null;
  let [dd, mm, yy] = parts;
  dd = parseInt(dd, 10);
  mm = parseInt(mm, 10);
  yy = parseInt(yy, 10);
  if (isNaN(dd) || isNaN(mm) || isNaN(yy)) return null;
  yy = yy < 100 ? 2000 + yy : yy;
  const dateObj = new Date(yy, mm - 1, dd);
  return isNaN(dateObj.getTime()) ? null : dateObj;
}

function isOverdue(dueDateStr, status) {
  const dueDate = parseDDMMYY(dueDateStr);
  if (!dueDate) return false;
  const statusLower = (status || "").toString().trim().toLowerCase();
  if (["completed","complete","done","closed","ok","resolved"].includes(statusLower)) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  return dueDate < today;
}

function isUnresolvedFailure(rectDate) {
  return !(rectDate && rectDate.toString().trim() !== "");
}

function statusBadge(status) {
  if (!status) return "-";
  const clean = status.toString().trim();
  const lower = clean.toLowerCase();
  let cls = "status-neutral";
  if (["completed","complete","resolved","closed","done","ok","normal","healthy","restored"].includes(lower)) cls = "status-good";
  else if (["pending","in progress","ongoing","scheduled","due","under observation"].includes(lower)) cls = "status-warn";
  else if (["failed","failure","critical","open","overdue","not ok","tripped"].includes(lower)) cls = "status-bad";
  return `<span class="status-pill ${cls}">${clean}</span>`;
}

function filterRowsByDateRange(rows, dateColIndex, rangeValue) {
  if (rangeValue === 'all' || !rangeValue) return rows;
  const today = new Date(); today.setHours(0,0,0,0);
  return rows.filter(row => {
    const d = parseDDMMYY(row[dateColIndex]);
    if (!d) return false;
    if (rangeValue === '30days') {
      const diffDays = (today - d) / 86400000;
      return diffDays >= 0 && diffDays <= 30;
    }
    if (rangeValue === 'thisyear') return d.getFullYear() === today.getFullYear();
    return true;
  });
}

function sortRowsByDateDesc(rows, dateColIndex) {
  return [...rows].sort((a, b) => {
    const da = parseDDMMYY(a[dateColIndex]);
    const db = parseDDMMYY(b[dateColIndex]);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
}

function groupRowsByYear(rows, dateColIndex) {
  const groups = {};
  rows.forEach(row => {
    const d = parseDDMMYY(row[dateColIndex]);
    const year = d ? d.getFullYear().toString() : 'Unknown';
    if (!groups[year]) groups[year] = [];
    groups[year].push(row);
  });
  return groups;
}

function getSortedYearKeys(groups) {
  return Object.keys(groups).sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return parseInt(b) - parseInt(a);
  });
}

function paginateArray(arr, page, perPage) {
  const start = (page - 1) * perPage;
  return arr.slice(start, start + perPage);
}

function downloadCSV(filename, headers, rows) {
  let csvContent = headers.join(",") + "\n";
  rows.forEach(r => {
    const escaped = r.map(val => {
      let v = (val === undefined || val === null) ? "" : val.toString();
      v = v.replace(/"/g, '""');
      if (/[",\n]/.test(v)) v = `"${v}"`;
      return v;
    });
    csvContent += escaped.join(",") + "\n";
  });
  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openPrintableWindow(title, tableHeadHtml, tableBodyHtml) {
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
    <head>
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h3 { margin-bottom: 14px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #444; padding: 6px 8px; text-align: left; }
      th { background: #0f766e; color: #fff; text-transform: uppercase; font-size: 10.5px; }
      tr:nth-child(even) { background: #f5f5f5; }
      a { color: #1a73e8; }
    </style>
    </head>
    <body>
      <h3>${title}</h3>
      <table>
        <thead><tr>${tableHeadHtml}</tr></thead>
        <tbody>${tableBodyHtml}</tbody>
      </table>
    </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

function toggleYearGroup(type, year) {
  const st = state[type];
  st.expandedYears[year] = !st.expandedYears[year];
  if (type === 'maintenance') renderMaintenanceUI(); else renderFailureUI();
}

function changeYearPage(type, year, direction) {
  const st = state[type];
  const current = st.pages[year] || 1;
  st.pages[year] = Math.max(1, current + direction);
  if (type === 'maintenance') renderMaintenanceUI(); else renderFailureUI();
}

function onDateFilterChange(type, selectEl) {
  state[type].filter = selectEl.value;
  state[type].pages = {};
  if (type === 'maintenance') renderMaintenanceUI(); else renderFailureUI();
}

// ============================================================
// MAINTENANCE EXPORTS (CSV + PDF)
// ============================================================
function exportMaintenanceCSV() {
  const st = state.maintenance;
  if (!st.rows.length) return;
  const meta = st.meta;
  const DATE_COL = 1;
  const filtered = filterRowsByDateRange(st.rows, DATE_COL, st.filter);
  const sorted = sortRowsByDateDesc(filtered, DATE_COL);

  const headers = ["SL","Station","Group","Sub Equipment","Asset Name","Date of Maintenance","Type of Maintenance","Attended By","Checksheet","Remarks"];
  const csvRows = sorted.map((row, idx) => [
    idx + 1, meta.station, meta.group, meta.subGroup, meta.equipmentName,
    row[1] || "", row[2] || "", row[3] || "", row[4] || "", row[5] || ""
  ]);
  downloadCSV(`Maintenance_${meta.equipmentName || 'Asset'}_${Date.now()}.csv`, headers, csvRows);
}

function exportMaintenancePDF() {
  const st = state.maintenance;
  if (!st.rows.length) return;
  const meta = st.meta;
  const DATE_COL = 1;
  const filtered = filterRowsByDateRange(st.rows, DATE_COL, st.filter);
  const sorted = sortRowsByDateDesc(filtered, DATE_COL);

  const headHtml = `<th>SL</th><th>Station</th><th>Group</th><th>Sub Equipment</th><th>Asset Name</th>
    <th>Date of Maintenance</th><th>Type of Maintenance</th><th>Attended By</th><th>Checksheet</th><th>Remarks</th>`;

  const bodyHtml = sorted.map((row, idx) => {
    const checksheet = row[4] ? `<a href="${row[4]}" target="_blank">CHECKSHEET</a>` : "-";
    return `<tr>
      <td>${idx+1}</td><td>${meta.station}</td><td>${meta.group}</td><td>${meta.subGroup}</td><td>${meta.equipmentName}</td>
      <td>${row[1]||""}</td><td>${row[2]||""}</td><td>${row[3]||""}</td><td>${checksheet}</td><td>${row[5]||""}</td>
    </tr>`;
  }).join("");

  openPrintableWindow(`Maintenance Records - ${meta.equipmentName || 'Asset'} (${meta.station})`, headHtml, bodyHtml);
}

// ============================================================
// FAILURE EXPORTS (CSV + PDF)
// ============================================================
function exportFailureCSV() {
  const st = state.failure;
  if (!st.rows.length) return;
  const meta = st.meta;
  const DATE_COL = 1;
  const filtered = filterRowsByDateRange(st.rows, DATE_COL, st.filter);
  const sorted = sortRowsByDateDesc(filtered, DATE_COL);

  const headers = ["SL","Station","Group","Sub Equipment","Asset Name","Date of Failure","Fault","Reported By","Repercussion","Cause of Failure","Action Taken","Attended By","Rectification Date"];
  const csvRows = sorted.map((row, idx) => [
    idx + 1, meta.station, meta.group, meta.subGroup, meta.equipmentName,
    row[1] || "", row[2] || "", row[3] || "", row[4] || "", row[5] || "", row[6] || "", row[7] || "", row[8] || ""
  ]);
  downloadCSV(`Failure_${meta.equipmentName || 'Asset'}_${Date.now()}.csv`, headers, csvRows);
}

function exportFailurePDF() {
  const st = state.failure;
  if (!st.rows.length) return;
  const meta = st.meta;
  const DATE_COL = 1;
  const filtered = filterRowsByDateRange(st.rows, DATE_COL, st.filter);
  const sorted = sortRowsByDateDesc(filtered, DATE_COL);

  const headHtml = `<th>SL</th><th>Station</th><th>Group</th><th>Sub Equipment</th><th>Asset Name</th>
    <th>Date of Failure</th><th>Fault</th><th>Reported By</th><th>Repercussion</th><th>Cause of Failure</th>
    <th>Action Taken</th><th>Attended By</th><th>Rectification Date</th>`;

  const bodyHtml = sorted.map((row, idx) => `<tr>
    <td>${idx+1}</td><td>${meta.station}</td><td>${meta.group}</td><td>${meta.subGroup}</td><td>${meta.equipmentName}</td>
    <td>${row[1]||""}</td><td>${row[2]||""}</td><td>${row[3]||""}</td><td>${row[4]||""}</td><td>${row[5]||""}</td>
    <td>${row[6]||""}</td><td>${row[7]||""}</td><td>${row[8]||""}</td>
  </tr>`).join("");

  openPrintableWindow(`Failure Records - ${meta.equipmentName || 'Asset'} (${meta.station})`, headHtml, bodyHtml);
}

async function fetchActualSheetTitles() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${API_KEY}&fields=sheets.properties.title`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) return { error: data.error ? data.error.message : "Unknown metadata error" };
  return { titles: (data.sheets || []).map(s => s.properties.title) };
}

function buildDiagnosticHtml(expectedNames, actualTitlesResult, rawErrorMessage) {
  let html = `<div class="alert-error" style="margin-top:10px; text-align:left;">
    <strong>❌ Sync failed — Diagnostic Report</strong><br><br>
    <strong>Raw API error:</strong> ${rawErrorMessage || "N/A"}<br><br>
    <strong>Sheets this Asset ID needs:</strong><br>
    &nbsp;&nbsp;• ${expectedNames.maintenance}<br>
    &nbsp;&nbsp;• ${expectedNames.failure}<br>
    &nbsp;&nbsp;• ${expectedNames.specifications}<br><br>`;

  if (actualTitlesResult.error) {
    html += `<strong>Could not read your spreadsheet's tab list:</strong> ${actualTitlesResult.error}<br>
    (Check that the Sheet is shared as "Anyone with the link can view" and API key is valid/unrestricted for this domain.)`;
  } else {
    const actual = actualTitlesResult.titles;
    html += `<strong>Tabs that actually exist in your spreadsheet:</strong><br>&nbsp;&nbsp;${actual.join("<br>&nbsp;&nbsp;")}<br><br>`;
    const missing = [expectedNames.maintenance, expectedNames.failure, expectedNames.specifications]
      .filter(n => !actual.includes(n));
    if (missing.length > 0) {
      html += `<strong style="color:#b91c1c;">⚠ Missing or mismatched tab(s):</strong><br>&nbsp;&nbsp;${missing.join("<br>&nbsp;&nbsp;")}<br><br>
      Create these exact tab names (case-sensitive, no trailing spaces) in your spreadsheet.`;
    } else {
      html += `All 3 expected tabs exist with matching names. The issue may be a temporary network error — please try again.`;
    }
  }
  html += `</div>`;
  return html;
}

function qSheet(name) { return `'${name}'`; }

async function fetchColumnAOnly(sheetNames) {
  const ranges = [
    `${qSheet(sheetNames.maintenance)}!A2:A`,
    `${qSheet(sheetNames.failure)}!A2:A`,
    `${qSheet(sheetNames.specifications)}!A2:A`
  ];
  const rangesQuery = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${rangesQuery}&key=${API_KEY}`;
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    const msg = payload.error ? payload.error.message : `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return payload.valueRanges || [];
}

function findExactMatchRows(columnAValueRange, targetId) {
  if (!columnAValueRange || !columnAValueRange.values) return [];
  const rows = [];
  columnAValueRange.values.forEach((rowArr, idx) => {
    const cell = rowArr[0] ? rowArr[0].toString().trim() : "";
    if (cell === targetId) rows.push(idx + 2);
  });
  return rows;
}

function findSpecHeaderRow(columnAValueRange, targetId7) {
  if (!columnAValueRange || !columnAValueRange.values) return null;
  for (let idx = 0; idx < columnAValueRange.values.length; idx++) {
    const cell = columnAValueRange.values[idx][0];
    if (cell && cell.toString().trim().substring(0, 7) === targetId7) {
      return idx + 2;
    }
  }
  return null;
}

function buildRowRanges(sheetName, rowNumbers, colStart, colEnd) {
  return rowNumbers.map(r => `${qSheet(sheetName)}!${colStart}${r}:${colEnd}${r}`);
}

async function fetchTargetedRows(sheetNames, maintRows, failRows, specHeaderRow) {
  let ranges = [];
  let sections = { maint: 0, fail: 0, spec: 0 };

  if (maintRows.length > 0) {
    ranges.push(...buildRowRanges(sheetNames.maintenance, maintRows, "A", "F"));
    sections.maint = maintRows.length;
  }
  if (failRows.length > 0) {
    ranges.push(...buildRowRanges(sheetNames.failure, failRows, "A", "I"));
    sections.fail = failRows.length;
  }
  if (specHeaderRow !== null) {
    ranges.push(`${qSheet(sheetNames.specifications)}!A${specHeaderRow}:Z${specHeaderRow}`);
    ranges.push(`${qSheet(sheetNames.specifications)}!A${specHeaderRow + 1}:Z${specHeaderRow + 1}`);
    sections.spec = 1;
  }

  if (ranges.length === 0) {
    return { maintenance: [], failure: [], specifications: null };
  }

  const rangesQuery = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${rangesQuery}&key=${API_KEY}`;
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    const msg = payload.error ? payload.error.message : `HTTP ${response.status}`;
    throw new Error(msg);
  }
  const valueRanges = payload.valueRanges || [];

  let cursor = 0;
  const maintenance = [];
  for (let i = 0; i < sections.maint; i++) {
    const vr = valueRanges[cursor++];
    maintenance.push(vr && vr.values ? vr.values[0] : []);
  }
  const failure = [];
  for (let i = 0; i < sections.fail; i++) {
    const vr = valueRanges[cursor++];
    failure.push(vr && vr.values ? vr.values[0] : []);
  }
  let specifications = null;
  if (sections.spec) {
    const headerVR = valueRanges[cursor++];
    const valueVR = valueRanges[cursor++];
    specifications = {
      headers: headerVR && headerVR.values ? headerVR.values[0] : [],
      values: valueVR && valueVR.values ? valueVR.values[0] : []
    };
  }
  return { maintenance, failure, specifications };
}

// ============================================================
// NEW: CHECKSHEET TAB — fetch reference PDF link from Checksheet_ALL
// Column A = 4-digit Group+SubGroup code (digits 4-7 of Asset ID)
// Column B = Google Drive shareable link to the PDF format
// ============================================================
async function fetchChecksheetRows() {
  const range = `${qSheet(CHECKSHEET_SHEET_NAME)}!A2:B`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error ? data.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.values || [];
}

function findChecksheetLink(rows, code4) {
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i][0] ? rows[i][0].toString().trim() : "";
    if (cell === code4) {
      return rows[i][1] ? rows[i][1].toString().trim() : "";
    }
  }
  return "";
}

function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

function buildDrivePreviewUrl(rawUrl) {
  const fileId = extractDriveFileId(rawUrl);
  if (!fileId) return rawUrl;
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

function buildDriveMediaUrl(fileId) {
  // Requires the file to be shared "Anyone with the link"
  // AND the Drive API enabled for your API key's project.
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;
}

async function fetchPdfArrayBuffer(fileId) {
  const url = buildDriveMediaUrl(fileId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF (HTTP ${res.status})`);
  return await res.arrayBuffer();
}

async function renderChecksheetTab(link, errorMsg) {
  const container = document.getElementById('checksheetData');
  if (!container) return;

  if (errorMsg) {
    container.innerHTML = `<div class="alert-error">⚠ Could not load reference checksheet: ${errorMsg}</div>`;
    return;
  }
  if (!link) {
    container.innerHTML = `<p style="color:#666; font-style: italic;">No reference checksheet format registered yet for this equipment type (Group + Sub-Group code). Please add a row in "Checksheet_ALL" sheet (Col A = 4-digit code, Col B = Google Drive link).</p>`;
    return;
  }

  const fileId = extractDriveFileId(link);
  if (!fileId) {
    container.innerHTML = `<div class="alert-error">⚠ Invalid Google Drive link.</div>`;
    return;
  }

  container.innerHTML = `<p style="color:#666;">Loading checksheet...</p>`;

  try {
    const arrayBuffer = await fetchPdfArrayBuffer(fileId);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let currentPage = 1;
    const totalPages = pdf.numPages;

    container.innerHTML = `
      <div class="checksheet-frame-wrap">
        <canvas id="checksheetCanvas" class="checksheet-frame"></canvas>
      </div>
      <div class="checksheet-pager">
        <button id="csPrevBtn">‹ Prev</button>
        <span>Page <span id="csPageNum">1</span> / ${totalPages}</span>
        <button id="csNextBtn">Next ›</button>
      </div>
      <p class="checksheet-note">📄 Reference Checksheet Format — View Only</p>
    `;

    const canvas = document.getElementById('checksheetCanvas');
    const ctx = canvas.getContext('2d');

    async function renderPage(num) {
      const page = await pdf.getPage(num);
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      document.getElementById('csPageNum').textContent = num;
    }

    document.getElementById('csPrevBtn').addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderPage(currentPage); }
    });
    document.getElementById('csNextBtn').addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderPage(currentPage); }
    });

    await renderPage(currentPage);

  } catch (err) {
    container.innerHTML = `<div class="alert-error">⚠ Could not render checksheet: ${err.message}</div>`;
  }
}

// ============================================================
// NEW: MORE TAB — High / Medium / Low identical similar assets
// ============================================================
function jumpToAsset(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('id', id);
  window.location.href = url.toString();
}

function getHighMatchAssets(assetId) {
  // Same Station + Group + Sub-Group, different last 2 digits (Asset No)
  const group = assetId.substring(3, 5);
  const prefix7 = assetId.substring(0, 7);
  const validSet = validAssetIdsByGroup[group];
  if (!validSet) return [];
  const list = [];
  validSet.forEach(id => {
    if (id !== assetId && id.substring(0, 7) === prefix7) list.push(id);
  });
  return list.sort();
}

function getMediumMatchGroups(assetId) {
  // Same Station + Group, different Sub-Group — grouped by Sub-Group
  const station = assetId.substring(0, 3);
  const group = assetId.substring(3, 5);
  const currentSubGroup = assetId.substring(5, 7);
  const validSet = validAssetIdsByGroup[group];
  const grouped = {};
  if (!validSet) return grouped;
  validSet.forEach(id => {
    if (id.substring(0, 3) === station && id.substring(5, 7) !== currentSubGroup) {
      const sg = id.substring(5, 7);
      if (!grouped[sg]) grouped[sg] = [];
      grouped[sg].push(id);
    }
  });
  return grouped;
}

function getLowMatchGroups(assetId) {
  // Same Station, different Group entirely — grouped by Group (future expansion)
  const station = assetId.substring(0, 3);
  const currentGroup = assetId.substring(3, 5);
  const grouped = {};
  Object.keys(validAssetIdsByGroup).forEach(group => {
    if (group === currentGroup) return;
    const validSet = validAssetIdsByGroup[group];
    validSet.forEach(id => {
      if (id.substring(0, 3) === station) {
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(id);
      }
    });
  });
  return grouped;
}

function renderMoreChip(id) {
  const m = getAssetMetadata(id);
  const label = m.equipmentName || id;
  return `<button class="more-chip" onclick="jumpToAsset('${id}')" title="${id}">${label}</button>`;
}

function toggleMoreGroup(type, key) {
  moreState[type][key] = !moreState[type][key];
  if (currentAssetId) renderMoreTab(currentAssetId);
}

function renderMoreTab(assetId) {
  const container = document.getElementById('moreData');
  if (!container) return;
  const meta = getAssetMetadata(assetId);
  const group = assetId.substring(3, 5);

  let html = "";

  // ---- HIGH MATCH (flat chip list, not expandable) ----
  const highList = getHighMatchAssets(assetId);
  html += `
    <div class="more-section">
      <h4 class="more-section-title high-title">🎯 Same Equipment — Other Units <span class="more-subtle">(${meta.subGroup || '-'})</span></h4>
      ${highList.length === 0
        ? `<p class="more-empty">No other identical units found for this equipment type at ${meta.station || 'this station'}.</p>`
        : `<div class="more-chip-list">${highList.map(renderMoreChip).join('')}</div>`
      }
    </div>
  `;

  // ---- MEDIUM MATCH (expandable per Sub-Group) ----
  const mediumGroups = getMediumMatchGroups(assetId);
  const mediumKeys = Object.keys(mediumGroups).sort();
  html += `<div class="more-section">
    <h4 class="more-section-title medium-title">🧭 Other Equipment Types — Same Group <span class="more-subtle">(${meta.group || '-'})</span></h4>`;
  if (mediumKeys.length === 0) {
    html += `<p class="more-empty">No other equipment types registered under this group at ${meta.station || 'this station'} yet.</p>`;
  } else {
    mediumKeys.forEach(sg => {
      const sgName = (subGroupMap[group] && subGroupMap[group][sg]) || `Sub-Group ${sg}`;
      const ids = mediumGroups[sg].sort();
      const isExpanded = !!moreState.medium[sg];
      html += `
        <div class="more-group">
          <div class="more-group-header" onclick="toggleMoreGroup('medium','${sg}')">
            <span class="more-toggle-icon ${isExpanded ? 'expanded' : ''}">►</span>
            <span class="more-group-label">${sgName}</span>
            <span class="more-group-count">(${ids.length} unit${ids.length !== 1 ? 's' : ''})</span>
          </div>
          <div class="more-group-body ${isExpanded ? '' : 'collapsed'}">
            <div class="more-chip-list">${ids.map(renderMoreChip).join('')}</div>
          </div>
        </div>
      `;
    });
  }
  html += `</div>`;

  // ---- LOW MATCH (expandable per Group — future) ----
  const lowGroups = getLowMatchGroups(assetId);
  const lowKeys = Object.keys(lowGroups).sort();
  html += `<div class="more-section">
    <h4 class="more-section-title low-title">🔮 Other Equipment Groups — Same Station <span class="more-subtle">(Future)</span></h4>`;
  if (lowKeys.length === 0) {
    html += `<p class="more-empty">Coming soon — other equipment groups (LT, Pump, DG, Third Rail, Lift &amp; Escalator, Fire, Split &amp; HVAC) will appear here once added to the Master Whitelist.</p>`;
  } else {
    lowKeys.forEach(g => {
      const gName = group[g] || `Group ${g}`;
      const ids = lowGroups[g].sort();
      const isExpanded = !!moreState.low[g];
      html += `
        <div class="more-group">
          <div class="more-group-header" onclick="toggleMoreGroup('low','${g}')">
            <span class="more-toggle-icon ${isExpanded ? 'expanded' : ''}">►</span>
            <span class="more-group-label">${gName}</span>
            <span class="more-group-count">(${ids.length} unit${ids.length !== 1 ? 's' : ''})</span>
          </div>
          <div class="more-group-body ${isExpanded ? '' : 'collapsed'}">
            <div class="more-chip-list">${ids.map(renderMoreChip).join('')}</div>
          </div>
        </div>
      `;
    });
  }
  html += `</div>`;

  container.innerHTML = html;
}

async function processAssetPipelines(assetId) {
  const loadingEl = document.getElementById('loadingStatus');
  const loadingText = document.getElementById('loadingText');
  loadingEl.style.display = "flex";
  loadingText.innerText = "Decoding asset identity...";

  // reset More-tab state for new lookup
  moreState.medium = {};
  moreState.low = {};
  currentAssetId = null;

  const isValid = runLocalDecoder(assetId);
  if (!isValid) {
    loadingEl.style.display = "none";
    document.getElementById('tabMenu').style.display = "none";
    document.getElementById('Page2').style.display = "none";
    document.getElementById('Page3').style.display = "none";
    document.getElementById('Page4').style.display = "none";
    document.getElementById('Page5').style.display = "none";
    document.getElementById('Page6').style.display = "none";
    return;
  }

  const sheetNames = getSheetNamesForAsset(assetId);
  if (!sheetNames) {
    loadingEl.style.display = "none";
    document.getElementById('decodedData').innerHTML += `
      <div class="alert-error" style="margin-top:10px;">
        <strong>No data sheets mapped for this equipment Group code.</strong><br>
        Please add an entry in <code>groupSheetSuffixMap</code>.
      </div>`;
    document.getElementById('tabMenu').style.display = "none";
    return;
  }

  try {
    loadingText.innerText = "Scanning index (Column A)...";
    const columnAResults = await fetchColumnAOnly(sheetNames);

    const maintRows = findExactMatchRows(columnAResults[0], assetId);
    const failRows  = findExactMatchRows(columnAResults[1], assetId);
    const specHeaderRow = findSpecHeaderRow(columnAResults[2], assetId.substring(0, 7));

    loadingText.innerText = "Fetching matched records...";
    const detailed = await fetchTargetedRows(sheetNames, maintRows, failRows, specHeaderRow);

    loadingEl.style.display = "none";
    document.getElementById('tabMenu').style.display = "flex";
    document.getElementById('Page1').style.display = "block";

    const meta = getAssetMetadata(assetId);
    const frequency = getFrequencyOfMaintenance(assetId);

    if (detailed.maintenance.length > 0) {
      const sortedMaint = sortRowsByDateDesc(detailed.maintenance, 1);
      const topRow = sortedMaint[0];
      const lastDateVal = topRow[1] || "";
      document.getElementById('lastMaintField').innerText = lastDateVal || "Not Tracked";

      const lastDateObj = parseDDMMYY(lastDateVal);
      const nextDateObj = (lastDateObj && frequency !== "Not Defined") ? addInterval(lastDateObj, frequency) : null;

      if (nextDateObj) {
        const today = new Date(); today.setHours(0,0,0,0);
        const overdueNow = nextDateObj < today;
        document.getElementById('nextMaintField').innerHTML =
          formatDateDDMMYY(nextDateObj) + (overdueNow ? `<span class="overdue-badge">OVERDUE</span>` : "");
        if (overdueNow) document.getElementById('nextMaintField').classList.add('overdue-text');
      } else {
        document.getElementById('nextMaintField').innerText = "Not Tracked";
      }
    } else {
      document.getElementById('lastMaintField').innerText = "No Records Available";
      document.getElementById('nextMaintField').innerText = "No Records Available";
    }

    // This Year / Total counters
    const currentYear = new Date().getFullYear();
    const totalMaint = detailed.maintenance.length;
    const thisYearMaint = detailed.maintenance.filter(r => {
      const d = parseDDMMYY(r[1]);
      return d && d.getFullYear() === currentYear;
    }).length;
    const totalFail = detailed.failure.length;
    const thisYearFail = detailed.failure.filter(r => {
      const d = parseDDMMYY(r[1]);
      return d && d.getFullYear() === currentYear;
    }).length;

    const yearMaintEl = document.getElementById('yearMaintField');
    if (yearMaintEl) yearMaintEl.innerText = `${thisYearMaint} / ${totalMaint}`;
    const yearFailEl = document.getElementById('yearFailField');
    if (yearFailEl) yearFailEl.innerText = `${thisYearFail} / ${totalFail}`;

    initMaintenanceUI(detailed.maintenance, meta);
    initFailureUI(detailed.failure, meta);
    renderSpecificationsOutput(detailed.specifications, 'specData');

    // NEW: More tab (instant, local whitelist based — no extra API call needed)
    currentAssetId = assetId;
    renderMoreTab(assetId);

    // NEW: Checksheet tab (separate try/catch so it never blocks the main flow)
    try {
      const checksheetRows = await fetchChecksheetRows();
      const code4 = assetId.substring(3, 7);
      const link = findChecksheetLink(checksheetRows, code4);
      renderChecksheetTab(link, null);
    } catch (csErr) {
      console.error(csErr);
      renderChecksheetTab(null, csErr.message);
    }

  } catch (err) {
    console.error(err);
    loadingText.innerText = "Running diagnostics...";
    const actualTitlesResult = await fetchActualSheetTitles();
    document.getElementById('loadingStatus').style.display = "none";
    document.getElementById('decodedData').innerHTML += buildDiagnosticHtml(sheetNames, actualTitlesResult, err.message);
  }
}

// ============================================================
// MAINTENANCE UI
// ============================================================
function initMaintenanceUI(rows, meta) {
  state.maintenance.rows = rows;
  state.maintenance.meta = meta;
  state.maintenance.filter = 'all';
  state.maintenance.pages = {};
  state.maintenance.expandedYears = null;
  renderMaintenanceUI();
}

function renderMaintenanceUI() {
  const container = document.getElementById('maintData');
  const st = state.maintenance;
  const meta = st.meta;

  if (!st.rows || st.rows.length === 0) {
    container.innerHTML = "<p style='color:#666; font-style: italic;'>No matching records in Maintenance registry.</p>";
    return;
  }

  const DATE_COL = 1;
  const totalCount = st.rows.length;
  const overdueCount = 0;

  const filtered = filterRowsByDateRange(st.rows, DATE_COL, st.filter);
  const sorted = sortRowsByDateDesc(filtered, DATE_COL);
  const showingCount = sorted.length;

  const yearGroups = groupRowsByYear(sorted, DATE_COL);
  const yearKeys = getSortedYearKeys(yearGroups);

  if (st.expandedYears === null) {
    st.expandedYears = {};
    yearKeys.forEach((y, idx) => { st.expandedYears[y] = idx === 0; });
  } else {
    yearKeys.forEach(y => { if (!(y in st.expandedYears)) st.expandedYears[y] = false; });
  }

  let html = `
    <div class="records-toolbar">
      <div class="record-counters">
        <span class="counter-badge total">Total: <strong>${totalCount}</strong></span>
        <span class="counter-badge overdue-counter">Overdue: <strong>${overdueCount}</strong></span>
        <span class="counter-badge showing">Showing: <strong>${showingCount}</strong></span>
      </div>
      <div class="toolbar-actions">
        <select class="date-filter-select" onchange="onDateFilterChange('maintenance', this)">
          <option value="all" ${st.filter === 'all' ? 'selected' : ''}>All Time</option>
          <option value="30days" ${st.filter === '30days' ? 'selected' : ''}>Last 30 Days</option>
          <option value="thisyear" ${st.filter === 'thisyear' ? 'selected' : ''}>This Year</option>
        </select>
        <button class="export-btn maint-btn" onclick="exportMaintenanceCSV()">⬇ Export CSV</button>
        <button class="export-btn pdf-btn" onclick="exportMaintenancePDF()">🖨 Export PDF</button>
      </div>
    </div>
  `;

  if (sorted.length === 0) {
    html += `<p style='color:#666; font-style: italic; margin-top:14px;'>No records match the selected date range.</p>`;
    container.innerHTML = html;
    return;
  }

  yearKeys.forEach(year => {
    const yearRows = yearGroups[year];
    const isExpanded = st.expandedYears[year];
    const page = st.pages[year] || 1;
    const totalPages = Math.max(1, Math.ceil(yearRows.length / ROWS_PER_PAGE));
    const pageRows = paginateArray(yearRows, page, ROWS_PER_PAGE);

    html += `
      <div class="year-group">
        <div class="year-header maint-year-header" onclick="toggleYearGroup('maintenance', '${year}')">
          <span class="year-toggle-icon ${isExpanded ? 'expanded' : ''}">▶</span>
          <span class="year-label">${year}</span>
          <span class="year-count">(${yearRows.length} record${yearRows.length !== 1 ? 's' : ''})</span>
        </div>
        <div class="year-body ${isExpanded ? '' : 'collapsed'}">
          <table class="maint-table responsive-table">
            <thead>
              <tr>
                <th>SL.</th><th>STATION</th><th>GROUP</th><th>SUB EQUIPMENT</th><th>ASSET NAME</th>
                <th>DATE OF MAINTENANCE</th><th>TYPE OF MAINTENANCE</th><th>ATTENDED BY</th><th>CHECKSHEET</th><th>REMARKS</th>
              </tr>
            </thead>
            <tbody>
    `;

    pageRows.forEach((row, idx) => {
      const slNo = (page - 1) * ROWS_PER_PAGE + idx + 1;
      const dateOfMaintenance = row[1] || "";
      const typeOfMaintenance = row[2] || "";
      const attendedBy = row[3] || "";
      const checksheetLink = row[4] || "";
      const remarks = row[5] || "";
      const checksheetCell = checksheetLink
        ? `<a href="${checksheetLink}" target="_blank" rel="noopener">CHECKSHEET</a>`
        : "-";

      html += `
        <tr>
          <td data-label="SL.">${slNo}</td>
          <td data-label="Station">${meta.station}</td>
          <td data-label="Group">${meta.group}</td>
          <td data-label="Sub Equipment">${meta.subGroup}</td>
          <td data-label="Asset Name">${meta.equipmentName}</td>
          <td data-label="Date of Maintenance">${dateOfMaintenance}</td>
          <td data-label="Type of Maintenance">${typeOfMaintenance}</td>
          <td data-label="Attended By">${attendedBy}</td>
          <td data-label="Checksheet">${checksheetCell}</td>
          <td data-label="Remarks">${remarks}</td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
    `;

    if (totalPages > 1) {
      html += `
        <div class="pagination-controls">
          <button class="page-btn" onclick="changeYearPage('maintenance','${year}',-1)" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
          <span class="page-info">Page ${page} of ${totalPages}</span>
          <button class="page-btn" onclick="changeYearPage('maintenance','${year}',1)" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ============================================================
// FAILURE UI
// ============================================================
function initFailureUI(rows, meta) {
  state.failure.rows = rows;
  state.failure.meta = meta;
  state.failure.filter = 'all';
  state.failure.pages = {};
  state.failure.expandedYears = null;
  renderFailureUI();
}

function renderFailureUI() {
  const container = document.getElementById('failData');
  const st = state.failure;
  const meta = st.meta;

  if (!st.rows || st.rows.length === 0) {
    container.innerHTML = "<p style='color:#666; font-style: italic;'>No matching records in Failure registry.</p>";
    return;
  }

  const DATE_COL = 1, RECT_COL = 8;
  const unresolvedCount = st.rows.filter(r => isUnresolvedFailure(r[RECT_COL])).length;
  const totalCount = st.rows.length;

  const filtered = filterRowsByDateRange(st.rows, DATE_COL, st.filter);
  const sorted = sortRowsByDateDesc(filtered, DATE_COL);
  const showingCount = sorted.length;

  const yearGroups = groupRowsByYear(sorted, DATE_COL);
  const yearKeys = getSortedYearKeys(yearGroups);

  if (st.expandedYears === null) {
    st.expandedYears = {};
    yearKeys.forEach((y, idx) => { st.expandedYears[y] = idx === 0; });
  } else {
    yearKeys.forEach(y => { if (!(y in st.expandedYears)) st.expandedYears[y] = false; });
  }

  let html = `
    <div class="records-toolbar">
      <div class="record-counters">
        <span class="counter-badge total">Total: <strong>${totalCount}</strong></span>
        <span class="counter-badge overdue-counter">Open/Unresolved: <strong>${unresolvedCount}</strong></span>
        <span class="counter-badge showing">Showing: <strong>${showingCount}</strong></span>
      </div>
      <div class="toolbar-actions">
        <select class="date-filter-select" onchange="onDateFilterChange('failure', this)">
          <option value="all" ${st.filter === 'all' ? 'selected' : ''}>All Time</option>
          <option value="30days" ${st.filter === '30days' ? 'selected' : ''}>Last 30 Days</option>
          <option value="thisyear" ${st.filter === 'thisyear' ? 'selected' : ''}>This Year</option>
        </select>
        <button class="export-btn fail-btn" onclick="exportFailureCSV()">⬇ Export CSV</button>
        <button class="export-btn pdf-btn" onclick="exportFailurePDF()">🖨 Export PDF</button>
      </div>
    </div>
  `;

  if (sorted.length === 0) {
    html += `<p style='color:#666; font-style: italic; margin-top:14px;'>No records match the selected date range.</p>`;
    container.innerHTML = html;
    return;
  }

  yearKeys.forEach(year => {
    const yearRows = yearGroups[year];
    const isExpanded = st.expandedYears[year];
    const page = st.pages[year] || 1;
    const totalPages = Math.max(1, Math.ceil(yearRows.length / ROWS_PER_PAGE));
    const pageRows = paginateArray(yearRows, page, ROWS_PER_PAGE);

    html += `
      <div class="year-group">
        <div class="year-header fail-year-header" onclick="toggleYearGroup('failure', '${year}')">
          <span class="year-toggle-icon ${isExpanded ? 'expanded' : ''}">▶</span>
          <span class="year-label">${year}</span>
          <span class="year-count">(${yearRows.length} record${yearRows.length !== 1 ? 's' : ''})</span>
        </div>
        <div class="year-body ${isExpanded ? '' : 'collapsed'}">
          <table class="fail-table responsive-table">
            <thead>
              <tr>
                <th>SL.</th><th>STATION</th><th>GROUP</th><th>SUB EQUIPMENT</th><th>ASSET NAME</th>
                <th>DATE OF FAILURE</th><th>FAULT</th><th>REPORTED BY</th><th>REPERCUSSION</th>
                <th>CAUSE OF FAILURE</th><th>ACTION TAKEN</th><th>ATTENDED BY</th><th>RECTIFICATION DATE</th>
              </tr>
            </thead>
            <tbody>
    `;

    pageRows.forEach((row, idx) => {
      const slNo = (page - 1) * ROWS_PER_PAGE + idx + 1;
      const dateOfFailure    = row[1] || "";
      const fault            = row[2] || "";
      const reportedBy       = row[3] || "";
      const repercussion     = row[4] || "";
      const causeOfFailure   = row[5] || "";
      const actionTaken      = row[6] || "";
      const attendedBy       = row[7] || "";
      const rectificationDate = row[8] || "";

      const rectCell = rectificationDate
        ? `<span class="status-pill status-good">${rectificationDate}</span>`
        : `<span class="status-pill status-bad">OPEN</span>`;

      html += `
        <tr>
          <td data-label="SL.">${slNo}</td>
          <td data-label="Station">${meta.station}</td>
          <td data-label="Group">${meta.group}</td>
          <td data-label="Sub Equipment">${meta.subGroup}</td>
          <td data-label="Asset Name">${meta.equipmentName}</td>
          <td data-label="Date of Failure">${dateOfFailure}</td>
          <td data-label="Fault">${fault}</td>
          <td data-label="Reported By">${reportedBy}</td>
          <td data-label="Repercussion">${repercussion}</td>
          <td data-label="Cause of Failure">${causeOfFailure}</td>
          <td data-label="Action Taken">${actionTaken}</td>
          <td data-label="Attended By">${attendedBy}</td>
          <td data-label="Rectification Date">${rectCell}</td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
    `;

    if (totalPages > 1) {
      html += `
        <div class="pagination-controls">
          <button class="page-btn" onclick="changeYearPage('failure','${year}',-1)" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
          <span class="page-info">Page ${page} of ${totalPages}</span>
          <button class="page-btn" onclick="changeYearPage('failure','${year}',1)" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ============================================================
// LOCAL DECODER — validates against whitelist
// ============================================================
function runLocalDecoder(id) {
  document.getElementById('Page1').style.display = "block";
  const meta = getAssetMetadata(id);

  const genericMappingOk = !!(meta.station && meta.group && meta.subGroup && meta.equipmentName);
  const existsInRegistry = isKnownValidAssetId(id);

  if (!genericMappingOk || !existsInRegistry) {
    let messageText = "Asset ID not matched";
    let subText = "The 9-digit code entered does not follow a recognized Station/Group/SubGroup/Asset pattern.";

    if (genericMappingOk && !existsInRegistry) {
      messageText = "Asset Not Registered At This Station";
      subText = `"${meta.equipmentName}" under "${meta.subGroup}" is not an installed unit at ${meta.station}. Please verify the Asset ID.`;
    }

    let errorHtml = `
      <div class="data-card" style="border-left-color: #d93025; background-color: #fce8e6;">
        <p style="color: #d93025; font-weight: bold; font-size: 18px; text-align: center; margin: 10px 0; display:block;">
          ${messageText}
        </p>
        <p style="color:#8a2e26; font-size: 13px; text-align:center; margin: 0;">
          ${subText}
        </p>
      </div>
    `;
    document.getElementById('decodedData').innerHTML = errorHtml;
    return false;
  }

  const frequency = getFrequencyOfMaintenance(id);

  let mappedHtml = `
    <div class="data-card">
      <p><span class="label">Asset ID :</span> <strong>${id}</strong></p>
      <p><span class="label">Station :</span> ${meta.station}</p>
      <p><span class="label">Group :</span> ${meta.group}</p>
      <p><span class="label">Sub-Group :</span> ${meta.subGroup}</p>
      <p><span class="label">Equipment Name :</span> <strong>${meta.equipmentName}</strong></p>
      <p><span class="label">Frequency Of Maintenance:</span> <span class="status-pill status-neutral">${frequency}</span></p>
      <hr style="border: 0; border-top: 1px dashed var(--border-color); margin: 12px 0;">
      <p><span class="label">Last Maintenance:</span> <span id="lastMaintField" style="font-weight:600; color:var(--primary-color)">Awaiting Sync...</span></p>
      <p><span class="label">Next Maintenance:</span> <span id="nextMaintField" style="font-weight:600; color:var(--primary-color)">Awaiting Sync...</span></p>
    </div>
    <div class="data-card" style="border-left-color: var(--maint-color);">
      <p><span class="label">This Year / Total Maintenance:</span> <span id="yearMaintField" style="font-weight:600; color:var(--maint-color)">Awaiting Sync...</span></p>
      <p><span class="label">This Year / Total Failure:</span> <span id="yearFailField" style="font-weight:600; color:var(--fail-color)">Awaiting Sync...</span></p>
    </div>
  `;
  document.getElementById('decodedData').innerHTML = mappedHtml;
  return true;
}

// ============================================================
// SPECIFICATIONS RENDER
// ============================================================
function renderSpecificationsOutput(specMatchedData, containerTargetId) {
  let frame = document.getElementById(containerTargetId);
  if (!specMatchedData || !specMatchedData.headers || !specMatchedData.values) {
    frame.innerHTML = "<p style='color:#666; font-style: italic;'>No matching specification details registered.</p>";
    return;
  }

  const headingCols = specMatchedData.headers;
  const valueCols = specMatchedData.values;

  let tableHtml = `<table class="spec-table"><tbody>`;
  let headingToggle = 0;

  for (let c = 1; c < headingCols.length; c++) {
    const headText = headingCols[c] ? headingCols[c].toString().trim() : "";
    if (headText === "") continue;

    const rawVal = valueCols[c];
    const cellValEmpty = (rawVal === undefined || rawVal === null || rawVal.toString().trim() === "");

    if (cellValEmpty) {
      headingToggle++;
      const altClass = (headingToggle % 2 === 0) ? 'spec-heading-b' : 'spec-heading-a';
      tableHtml += `
        <tr>
          <td colspan="2" class="spec-heading ${altClass}">${headText}</td>
        </tr>
      `;
    } else {
      const cellVal = rawVal.toString().trim();
      tableHtml += `
        <tr>
          <td class="spec-label">${headText}</td>
          <td>${cellVal}</td>
        </tr>
      `;
    }
  }

  tableHtml += `</tbody></table>`;
  frame.innerHTML = tableHtml;
}

function switchTab(clickEvent, targetPanelName) {
  let individualPanels = document.getElementsByClassName("tabcontent");
  for (let x = 0; x < individualPanels.length; x++) individualPanels[x].style.display = "none";

  let operationalTabs = document.getElementsByClassName("tablinks");
  for (let y = 0; y < operationalTabs.length; y++) operationalTabs[y].className = operationalTabs[y].className.replace(" active", "");

  document.getElementById(targetPanelName).style.display = "block";
  clickEvent.currentTarget.className += " active";
}

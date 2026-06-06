/**
 * Sea Turtle Survey — Google Sheets sync endpoint.
 *
 * SETUP
 *  1. Create a new Google Sheet.
 *  2. Extensions → Apps Script. Replace the default code with this whole file.
 *  3. Deploy → New deployment → Type: Web app
 *       - Description: Sea Turtle Survey sync
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Copy the deployment URL (ends in /exec). Paste it into the app's Settings.
 *  4. (Optional) Run the `setupTab` function once from the Apps Script editor
 *     to pre-create the "Sea Turtle Survey" tab with headers. Otherwise, the
 *     header is written automatically on the first submission.
 *
 * Payload shape (long-format, one row per turtle):
 *   {
 *     secret: "...",
 *     rows: [ { ...metadata, ...turtleFields }, ... ],
 *     schema: { meta: [...], turtle: [...] }
 *   }
 *
 * Tab:
 *   - "Sea Turtle Survey" — each row = one turtle observation. Metadata
 *     columns repeat for each turtle in the same survey (long format).
 */

const TAB_NAME = "Sea Turtle Survey";

// Shared secret token — must match the SYNC_SECRET constant in app.js.
// Rotate by regenerating, updating both files, redeploying the script and
// bumping the service-worker CACHE_VERSION.
const SYNC_SECRET = "7e484928-56fd-47d5-9729-1de2b184b061-b3febe8b";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SYNC_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    if (!body.rows || !body.rows.length) {
      return jsonResponse({ ok: false, error: "No rows in payload" });
    }
    if (!body.schema) {
      return jsonResponse({ ok: false, error: "Missing schema" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTab(ss, TAB_NAME, body.schema);
    const sheet = ss.getSheetByName(TAB_NAME);
    body.rows.forEach(function (row) { appendRow(sheet, row); });

    return jsonResponse({ ok: true, written: body.rows.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function doGet() {
  return jsonResponse({ ok: true, service: "Sea Turtle Survey sync", time: new Date().toISOString() });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Make sure the tab exists with the right two-row header layout.
 * Row 1: merged category bands ("Survey Metadata", "Turtle Observation").
 * Row 2: actual column names.
 * If the tab already has rows, headers are left alone.
 */
function ensureTab(ss, name, schema) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() >= 2) return;

  var meta = schema.meta;
  var turtle = schema.turtle;
  var allCols = meta.concat(turtle);

  var bands = [
    { start: 1, length: meta.length, label: "Survey Metadata" },
    { start: meta.length + 1, length: turtle.length, label: "Turtle Observation" },
  ];

  bands.forEach(function (band) {
    var range = sheet.getRange(1, band.start, 1, band.length);
    range.setValues([[band.label].concat(repeat("", band.length - 1))]);
    if (band.length > 1) range.merge();
    range
      .setBackground("#0b3d3d")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  });

  sheet.getRange(2, 1, 1, allCols.length).setValues([allCols]);
  sheet.getRange(2, 1, 1, allCols.length)
    .setBackground("#156a64")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setWrap(true);

  sheet.setFrozenRows(2);
  for (var i = 1; i <= Math.min(12, allCols.length); i++) sheet.autoResizeColumn(i);
}

function appendRow(sheet, rowObj) {
  var headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return rowObj[h] === undefined ? "" : rowObj[h];
  });
  sheet.appendRow(row);
}

function repeat(v, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(v);
  return out;
}

/**
 * Optional: pre-create the tab with headers, without submitting data.
 * Run once from the Apps Script editor if you want headers ready before
 * the first sync.
 */
function setupTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTab(ss, TAB_NAME, EMBEDDED_SCHEMA);
}

// Mirror of the schema the app sends. Keep in sync with app.js buildSchema().
const EMBEDDED_SCHEMA = {
  meta: [
    "surveyId",
    "submittedAt",
    "surveyLeader",
    "uploadedBy",
    "numberOfSurveyors",
    "dateDay",
    "dateMonth",
    "dateYear",
    "site",
    "surveyDuration",
    "numberOfLargeBoatsAtSite",
    "numberOfSmallBoatsAtSite",
    "numberOfTouristsAtSite",
    "numberOfTurtlesSeen",
  ],
  turtle: [
    "turtleNumber",
    "timeSeen",
    "depthObserved",
    "species",
    "speciesOther",
    "behaviour",
    "size",
    "sex",
    "turtleName",
    "markings",
  ],
};

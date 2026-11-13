import { strToU8, zipSync } from "fflate";

export type RegisterCell = string | number;
type RegisterSheet = { name: string; rows: RegisterCell[][]; widths: number[]; filter: boolean };
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const workbookNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const escapeXml = (value: string) => value.toWellFormed()
  .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "\ufffd")
  .replace(/_x[0-9a-f]{4}_/gi, match => "_x005F_" + match.slice(1))
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function sheet(rows: RegisterCell[][], widths: number[], filter: boolean) {
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const values = rows.map((row, index) => {
    const cells = row.map((value, col) => {
      const address = String.fromCharCode(65 + col) + (index + 1);
      return typeof value === "number" ? `<c r="${address}"><v>${value}</v></c>` :
        `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${index + 1}">${cells}</row>`;
  }).join("");
  return `${declaration}<worksheet xmlns="${workbookNamespace}">
    ${filter ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ""}
    <cols>${columns}</cols><sheetData>${values}</sheetData>
    ${filter ? `<autoFilter ref="A1:${String.fromCharCode(64 + widths.length)}${rows.length}"/>` : ""}
  </worksheet>`;
}

// Inline text preserves identifying numbers and keeps text separate from formulas.
export function loanRegisterWorkbook(sheets: RegisterSheet[]) {
  const indexed = sheets.map((sheet, index) => ({ ...sheet, id: index + 1 }));
  const files = {
    "[Content_Types].xml": `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      ${indexed.map(({ id }) => `<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
    </Types>`,
    "_rels/.rels": `${declaration}<Relationships xmlns="${packageRelationships}">
      <Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`,
    "xl/workbook.xml": `${declaration}<workbook xmlns="${workbookNamespace}" xmlns:r="${relationships}">
      <sheets>${indexed.map(({ name, id }) => `<sheet name="${escapeXml(name).replaceAll('"', "&quot;")}" sheetId="${id}" r:id="rId${id}"/>`).join("")}</sheets>
    </workbook>`,
    "xl/_rels/workbook.xml.rels": `${declaration}<Relationships xmlns="${packageRelationships}">
      ${indexed.map(({ id }) => `<Relationship Id="rId${id}" Type="${relationships}/worksheet" Target="worksheets/sheet${id}.xml"/>`).join("")}
    </Relationships>`,
    ...Object.fromEntries(indexed.map(({ id, rows, widths, filter }) => [`xl/worksheets/sheet${id}.xml`, sheet(rows, widths, filter)])),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
}

export function ohioRegisterWorkbook(registerRows: RegisterCell[][], scopeRows: RegisterCell[][], statementRows: RegisterCell[][]) {
  return loanRegisterWorkbook([
    { name: "Ohio loan register", rows: registerRows, widths: [29, 16, 18, 30, 36, 18, 25, 48, 25, 35], filter: true },
    { name: "Export scope", rows: scopeRows, widths: [32, 104], filter: false },
    { name: "Settlement statement index", rows: statementRows, widths: [23, 18, 32, 25, 40, 45, 29], filter: true },
  ]);
}

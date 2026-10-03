const excelJS = require('exceljs');

/**
 * A report is { title, columns: [{ key, header, width?, format? }], rows: [{...}], totals?: {...} }.
 * The same object feeds the on-screen table, the CSV and the Excel file, so they can never disagree.
 */

/**
 * Cells starting with = + - @ (or tab / CR) are formulas to Excel and Sheets. Task titles, names and
 * project names are typed by users, so a CSV opened in Excel could run one. A leading apostrophe makes
 * it text. (The .xlsx writer stores strings as strings, so it needs no escaping.)
 */
const neutralise = (value) => (typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(neutralise(value));
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** UTF-8 with a BOM, because Excel otherwise reads "Zoë" as mojibake. */
const toCsv = (report) => {
    const lines = [report.columns.map((c) => csvCell(c.header)).join(',')];
    const all = report.totals ? [...report.rows, report.totals] : report.rows;
    for (const row of all) lines.push(report.columns.map((c) => csvCell(row[c.key])).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
};

const toXlsx = async (report) => {
    const workbook = new excelJS.Workbook();
    const sheet = workbook.addWorksheet(report.title.slice(0, 31));
    sheet.columns = report.columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    report.rows.forEach((row) => sheet.addRow(row));
    if (report.totals) sheet.addRow(report.totals).font = { bold: true };
    return workbook.xlsx.writeBuffer();
};

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Sends the report in the requested format. `format` is "csv" or "xlsx". */
const sendReport = async (res, report, format) => {
    const name = `${slug(report.title)}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'csv') {
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
        return res.send(toCsv(report));
    }
    res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}.xlsx"`,
    });
    return res.send(Buffer.from(await toXlsx(report)));
};

module.exports = { neutralise, toCsv, toXlsx, sendReport };

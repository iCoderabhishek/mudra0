import { formatRupees } from "../../domain/money";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
export const money = (paise: bigint) => esc(formatRupees(paise));
export const grams = (mg: number) => `${(mg / 1000).toFixed(3)} g`;

export const table = (headers: string[], rows: string[][]) => `
<table>
  <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">None</td></tr>`}</tbody>
</table>`;

export const facts = (pairs: [string, string][]) =>
  `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;

export const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; max-width: 820px; margin: 24px auto; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin-top: 24px; }
  .muted { color: #555; }
  dl { display: grid; grid-template-columns: 220px 1fr; gap: 4px 12px; }
  dt { color: #555; } dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; }
  td:not(:first-child) { font-variant-numeric: tabular-nums; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Swarn Sathi Gold Loans</h1>
${body}
</body>
</html>`;

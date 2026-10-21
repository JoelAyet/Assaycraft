# Sample PDFs for the PDF import tests

Each file comes from a different tool, because PDFs differ a lot in how they store text (fonts, spaces, bullets, tables). All content is made up for testing.

| File                     | Made with                                                             | What it covers                                                                                                          |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `inoue-word.pdf`         | A Word document (python-docx) exported to PDF by LibreOffice          | Header with a logo and footer with page numbers, grid tables with wrapped cells, numbered steps across headings, figure |
| `gibson-chromium.pdf`    | HTML printed to PDF by Chromium                                       | Links, nested sub-steps, bullets drawn as shapes, super/subscripts, code, a two-column section across a page break      |
| `miniprep-reportlab.pdf` | ReportLab (standard PDF fonts, not embedded)                          | Bold headings, restarted numbering, super/subscripts, a running header                                                  |
| `paper-two-column.pdf`   | HTML with two justified columns and soft hyphens, printed by Chromium | Reading order of columns, hyphenation, superscript references                                                           |
| `kit-manual.pdf`         | HTML styled like a kit handbook, printed by Chromium                  | Cover page title and subtitle, contents page with dot leaders, tables with only horizontal rules, notes between steps   |
| `scanned.pdf`            | An image of a page, wrapped in a PDF by ReportLab                     | A PDF without text (a scan)                                                                                             |

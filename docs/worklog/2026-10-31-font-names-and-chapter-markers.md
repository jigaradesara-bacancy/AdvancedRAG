# Heading detection: font names and chapter markers

Symptom: sub-headings such as region names were read as body text, and the chapter number came out as 119 on one page.

Root cause: pdfjs-dist 6 hides font names unless `fontExtraProperties: true` is set, so bold detection never fired. The running header "C H A P T E R 1" is followed by the page number on the same line, so despacing the whole line glued them together.

What changed: font names are read from `commonObjs` after the operator list loads, and the chapter marker is parsed per text segment. A short, standalone line in a different font than the page's body font counts as a lowest-level heading.

Verification: ran the structured extractor on three pages of the World Bank report; chapter numbers read 1, 1 and 3, and "China" became a heading. Page 30, a boxed article in narrow columns, still produces a few odd headings. That is listed under known limitations.

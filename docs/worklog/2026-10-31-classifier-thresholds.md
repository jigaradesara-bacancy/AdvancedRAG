# Classifier thresholds recalibrated on real PDFs

Symptom: the first run classified both sample reports wrongly (the GPO report as mixed, the 200-page World Bank report as plain).

Root cause: three signals were too loose. Body font size was a weighted mode over all text, which chart labels skewed. Any page with three images or 15 drawing operations counted as visual, so photo spreads inflated the visual ratio to between 0.24 and 0.41. Heading density counted divider pages, so the report's real sub-heading structure scored below the threshold.

What changed: body size is the median of per-page dominant sizes. A page is visual only if it is graphics-heavy and has under 1,500 characters of text, or is numeric-dense with graphics. Structured now requires headings on 18% of prose pages. Mixed requires 35% visual pages. Thresholds live in `classifier.js` and `analyzer.js`.

Verification: classifier unit tests pass; the GPO report now classifies as plain and the World Bank report as structured. The 11-page visual document was not available, so the visual thresholds are checked only against synthetic page signals. Re-check them when the iMac PDF is added.

# Security policy

## Reporting

Report vulnerabilities privately via GitHub: **Security → Report a vulnerability** on
[vaishak-v-nair/Ingot](https://github.com/vaishak-v-nair/Ingot/security/advisories/new).
You will get a response within a week. No bounty program exists; credit is given in the
advisory and in `docs/measurements.md` when the fix ships.

## What counts

The most serious class of defect in this project is a **wrong number**: anything that makes
Ingot report contamination that is not there, or stay silent about contamination that is.
Report those the same way even when they are not classically "security" — a scanner that
can be made to lie is worse than one that can be crashed.

Also in scope:

- Script injection into the generated HTML reports or the site (both are supposed to be
  self-contained, with no external requests — see `docs/threat-model.md`).
- Anything that makes the browser scanner exfiltrate corpus data. The design claim is that
  nothing leaves the machine; a violation of that claim is critical by definition.
- Supply-chain issues in the build (`scripts/build-web.ts` pins its one build-time tool;
  the published package has zero runtime dependencies).

## Out of scope

- Adversarial trimming — a vendor editing their corpus until the scan passes. Documented
  plainly as an open problem in `docs/threat-model.md`; it is a limitation, not a bug.
- Forging the non-cryptographic `benchmarkHash` or the sampled `corpusHash`. Both document
  exactly what they do and do not protect.

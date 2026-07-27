# Ingot spike test

Scanner ingot-0.1.0. Human reference dolly-15k (human-authored), machine reference alpaca-52k (text-davinci-003).
Batch size 1200. Baselines built on the first half of each corpus; every record scored here comes from the held-out second half.

Each contamination level is 5 independent draws; the figure is mean ± standard deviation.

| machine contamination | purity | draws | confidence |
|---|---|---|---|
| 0% | 88.0 ± 4.7 | 5 | medium |
| 5% | 90.2 ± 6.6 | 5 | high |
| 10% | 87.6 ± 10.2 | 5 | medium |
| 25% | 81.2 ± 5.0 | 5 | medium |
| 50% | 56.4 ± 7.7 | 5 | medium |

Monotonic: **no**
Clean-human control: 8 batches, purity mean 89.9, sd 4.7
False positive rate at purity < 85: **13% (1/8)**
Detection floor (first ratio more than 2 control SD below the clean mean): **50%**

## Stated limitations

- The machine reference is 2023-era text-davinci-003 output. Current frontier output is harder to separate. Treat this curve as an upper bound, not a claim about 2026 models.
- Cross-author stylometry, the strongest signal on a real vendor batch, is unavailable here because neither public corpus ships annotator ids.
- Evidence is batch-level. Ingot makes no determination about any single record.

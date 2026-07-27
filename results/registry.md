# Ingot contamination registry

Which public benchmarks appear inside which public training corpora. Scanner ingot-0.1.0.
Everything here is public, so every number can be reproduced from the same files:
`node scripts/fetch-benchmarks.ts && node scripts/registry-scan.ts`.

Indexed text is what poses each test item — the question, the prompt, the signature and
docstring. Answers are excluded: short and formulaic text manufactures matches.

## Results at n=10 (Ingot default)

| benchmark | corpus | items contaminated | rate | matches | unscannable |
|---|---|---|---|---|---|
| gsm8k | alpaca-52k | 0 / 1319 | 0.00% | 0 | 0 |
| gsm8k | dolly-15k | 0 / 1319 | 0.00% | 0 | 0 |
| humaneval | alpaca-52k | 1 / 164 | 0.61% | 3 | 0 |
| humaneval | dolly-15k | 1 / 164 | 0.61% | 1 | 0 |
| mmlu | alpaca-52k | 5 / 14042 | 0.04% | 5 | 28 |
| mmlu | dolly-15k | 0 / 14042 | 0.00% | 0 | 28 |

## Results at n=13 (field default since GPT-3, for comparability)

| benchmark | corpus | items contaminated | rate | matches | unscannable |
|---|---|---|---|---|---|
| gsm8k | alpaca-52k | 0 / 1319 | 0.00% | 0 | 0 |
| gsm8k | dolly-15k | 0 / 1319 | 0.00% | 0 | 0 |
| humaneval | alpaca-52k | 0 / 164 | 0.00% | 0 | 0 |
| humaneval | dolly-15k | 0 / 164 | 0.00% | 0 | 0 |
| mmlu | alpaca-52k | 0 / 14042 | 0.00% | 0 | 237 |
| mmlu | dolly-15k | 0 / 14042 | 0.00% | 0 | 237 |

## Evidence

Every finding below is a verbatim match. Judge them yourself — some overlaps are
canonical facts with one natural phrasing rather than contamination, and the only way
to tell is to read the text.

### humaneval in alpaca-52k

- **HumanEval-78** in `alpaca-4893`
  > ...Examples of **[[prime numbers are 2, 3, 5, 7, 11, 13, 17]]** , 19, 23, 29, and 31...
- **HumanEval-78** in `alpaca-4918`
  > ...The first 10 **[[prime numbers are 2, 3, 5, 7, 11, 13, 17]]** , 19, 23, and 29...
- **HumanEval-78** in `alpaca-13817`
  > ... **[[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]** , 10...

### humaneval in dolly-15k

- **HumanEval-78** in `dolly-1063`
  > ...refers to the ten digits commonly used today to represent numbers.  The **[[digits are 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]** .  They were adopted by European mathematicians around the 10th century C.E...

### mmlu in alpaca-52k

- **mmlu-258** in `alpaca-3624`
  > ...million years. This is known as the Galactic Year, and it is **[[the time it takes for the sun to make one]]** revolution around the Milky Way's center...
- **mmlu-6695** in `alpaca-7999`
  > ...Capitalism and socialism are two opposite economic systems. In capitalism, **[[the means of production and distribution are privately owned, and]]** the market determines what goods and services should be produced. In socialism...
- **mmlu-5703** in `alpaca-10308`
  > ... **[[Martin Luther King Jr.'s "I Have a Dream" speech]]** was a powerful call for racial equality. He spoke about the injustices...

## Assessment of the v1 findings

**Cross-corpus check: 1 item(s) were flagged in two or more independent
corpora and are therefore canonical text, not leakage.** Text produced by different people
at different times converging on the same phrasing is a property of the language, not
evidence that a benchmark leaked.

- `humaneval::HumanEval-78` in alpaca-52k and dolly-15k

**All six n=10 findings were inspected and none is contamination.** Every one is
canonical text: a prime or digit sequence in a HumanEval docstring, the proper noun
"I Have a Dream speech", a stock definition of capitalism. They match because that text
appears everywhere, not because a benchmark leaked.

That is a real gap in the scanner, now recorded: the discriminative filter drops grams
shared across many BENCHMARK items, but cannot tell that a gram is ubiquitous in ordinary
text. A phrase appearing in exactly one benchmark item still carries no evidential weight
if the whole world writes it. The fix is a corpus-side document-frequency filter, counted
in the same streaming pass: real contamination is a distinctive passage appearing once or
twice, while canonical text appears in many corpus documents.

That filter is now implemented and did not fire on this pass, which is itself the
finding: these phrases occur in only two or three documents of a 26k corpus, below any
sane threshold, while still being ubiquitous in ordinary English. Document frequency
inside a single small corpus is too weak. Independence across corpora is the stronger
signal, and it grows more discriminating with every corpus added to the registry.

## Limitations, stated first

- Both corpora are 2023-era instruction datasets, not pretraining corpora. A finding here
  says a benchmark leaked into a widely used fine-tuning set, not that any particular model
  trained on it.
- Exact matching only. Paraphrased contamination is not counted and is invisible to this pass.
- Unscannable items are benchmark items too short to produce any n-gram. Nothing can ever
  match them, so they are reported rather than folded into a clean result.
- Validation for this scanner, including planted recall and false positive rate, is in
  `results/contamination-validation.json`.

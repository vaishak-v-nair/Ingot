/**
 * The benchmarks the registry and the pretraining scans cover.
 *
 * Shared because both scripts write this list verbatim into their published results, and
 * two copies means a licence or a note can be corrected in one published file and stay
 * wrong in the other. What is indexed is the text that POSES each item — the question, the
 * prompt, the signature and docstring. Answers are excluded: short formulaic text
 * manufactures matches.
 */
export type Benchmark = {
  name: string;
  path: string;
  licence: string;
  note: string;
};

export const BENCHMARKS: Benchmark[] = [
  { name: 'gsm8k', path: 'data/bench/gsm8k.jsonl', licence: 'MIT', note: 'test split, question text' },
  { name: 'humaneval', path: 'data/bench/humaneval.jsonl', licence: 'MIT', note: 'prompt: signature + docstring' },
  { name: 'mmlu', path: 'data/bench/mmlu.jsonl', licence: 'MIT', note: 'test split, question + choices' },
];

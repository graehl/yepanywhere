/**
 * Fit the heat-field recognizer: per-class heat and decay, sparse
 * per-code-point overrides, sparse left/right neighbour-class pair heat,
 * and a threshold θ. Loss is weighted logistic per character with an exact
 * gradient through both field recurrences; Adam with L2 on class
 * parameters and proximal L1 on the sparse ones. Features come from the
 * server's own unicodeMathFeatures, so training and runtime cannot drift.
 */
import {
  UNICODE_MATH_CLASS_COUNT as K,
  UNICODE_MATH_CLASSES,
  UNICODE_MATH_TAIL_CLASS as TAIL,
  type UnicodeMathParams,
  unicodeMathFeatures,
} from "../../packages/server/src/augments/unicode-math-recognizer.js";
import { seededRandom } from "./informalize.js";
import type { TrainingRow } from "./corpus.js";

export interface FitOptions {
  epochs: number;
  learningRate: number;
  /** Extra weight on positive characters. */
  positiveWeight: number;
  /** Proximal L1 on overrides and pairs. */
  l1: number;
  l2: number;
  /** Minimum training occurrences for a code point to get an override. */
  minOverride: number;
  seed: number;
}

export const DEFAULT_FIT: FitOptions = {
  epochs: 8,
  learningRate: 0.03,
  positiveWeight: 2,
  l1: 0.03,
  l2: 0.0005,
  minOverride: 30,
  seed: 1,
};

const SOFT_WEIGHT = 0.3;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

// Hand-set starting point: math characters hot with slow decay, prose
// words and identifiers cold with fast decay.
function seedTables(): {
  heat: Float64Array;
  decay: Float64Array;
  theta: number;
} {
  const heat = new Float64Array(K);
  const decay = new Float64Array(K).fill(logit(0.8));
  const set = (name: string, h: number, d?: number) => {
    const k = UNICODE_MATH_CLASSES.indexOf(name);
    if (k < 0) throw new Error(`unknown class ${name}`);
    heat[k] = h;
    if (d !== undefined) decay[k] = logit(d);
  };
  for (const [name, h, d] of [
    ["big-op", 3, 0.95],
    ["script", 2, 0.95],
    ["sub-mark", 2, 0.95],
    ["sup-mark", 2, 0.95],
    ["greek", 1.5, 0.9],
    ["math-symbol", 1.5, 0.9],
    ["math-letter", 1.5, 0.9],
    ["math-other", 1, 0.9],
    ["arrow", 0.3, 0.85],
    ["fn", 0.3, 0.9],
    ["l1", 0.2, 0.9],
    ["L1", 0.2, 0.9],
    ["digits", 0.1, 0.9],
    ["ascii=", 0.5, 0.9],
    ["space", 0, 0.85],
    ["l2", -0.2, 0.7],
    ["l3", -0.5, 0.6],
    ["word", -0.6, 0.4],
    ["ident", -1, 0.4],
    ["underscore", -0.5, 0.5],
    ["letter-other", -1, 0.4],
    ["punct-other", 0, 0.7],
  ] as const) {
    set(name, h, d);
  }
  return { heat, decay, theta: 1 };
}

interface PreparedRow {
  cls: Uint8Array;
  cps: Uint32Array;
  left: Uint8Array;
  right: Uint8Array;
  y: Uint8Array;
  w: Float32Array;
  weightSum: number;
}

function prepare(row: TrainingRow, positiveWeight: number): PreparedRow {
  const features = unicodeMathFeatures(row.text);
  const n = row.text.length;
  const y = new Uint8Array(n);
  const w = new Float32Array(n).fill(row.weight);
  for (const [s, e, k] of row.labels) {
    for (let i = s; i < e; i++) {
      if (k === "ignore") w[i] = 0;
      else {
        y[i] = 1;
        if (k === "soft") w[i] = (w[i] ?? 0) * SOFT_WEIGHT;
      }
    }
  }
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    if (y[i]) w[i] = (w[i] ?? 0) * positiveWeight;
    weightSum += w[i] ?? 0;
  }
  return { ...features, y, w, weightSum };
}

export function fitUnicodeMath(
  rows: readonly TrainingRow[],
  options: FitOptions,
  log: (line: string) => void,
): UnicodeMathParams {
  const prepared = rows.map((r) => prepare(r, options.positiveWeight));
  const counts = new Map<number, number>();
  for (const r of prepared) {
    for (const cp of r.cps) if (cp) counts.set(cp, (counts.get(cp) ?? 0) + 1);
  }
  const overrideCps = [...counts]
    .filter(([, n]) => n >= options.minOverride)
    .map(([cp]) => cp);
  const overrideIndex = new Map(overrideCps.map((cp, i) => [cp, i]));
  const O = overrideCps.length;
  const KK = K * K;
  // Layout: [heat K][decay K][dheat O][ddecay O][left KK][right KK][theta]
  const HEAT = 0;
  const DECAY = K;
  const DH = 2 * K;
  const DU = DH + O;
  const LEFT = DU + O;
  const RIGHT = LEFT + KK;
  const THETA = RIGHT + KK;
  const P = new Float64Array(THETA + 1);
  const seed = seedTables();
  P.set(seed.heat, HEAT);
  P.set(seed.decay, DECAY);
  P[THETA] = seed.theta;
  // A surrogate tail passes heat through unchanged (decay 1 at runtime), so
  // its class parameters are never trained.
  const frozen = new Set([HEAT + TAIL, DECAY + TAIL]);

  const rowGrad = (r: PreparedRow, G: Float64Array): number => {
    const n = r.cls.length;
    const h = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = r.cls[i] ?? 0;
      if (k === TAIL) {
        d[i] = 1;
        continue;
      }
      let heat =
        (P[HEAT + k] ?? 0) +
        (P[LEFT + (r.left[i] ?? 0) * K + k] ?? 0) +
        (P[RIGHT + k * K + (r.right[i] ?? 0)] ?? 0);
      let decay = P[DECAY + k] ?? 0;
      const o = r.cps[i] ? overrideIndex.get(r.cps[i] ?? 0) : undefined;
      if (o !== undefined) {
        heat += P[DH + o] ?? 0;
        decay += P[DU + o] ?? 0;
      }
      h[i] = heat;
      d[i] = sigmoid(decay);
    }
    const F = new Float64Array(n);
    const B = new Float64Array(n);
    let f = 0;
    for (let i = 0; i < n; i++) F[i] = f = (h[i] ?? 0) + (d[i] ?? 0) * f;
    let b = 0;
    for (let i = n - 1; i >= 0; i--) B[i] = b = (h[i] ?? 0) + (d[i] ?? 0) * b;
    const theta = P[THETA] ?? 0;
    const g = new Float64Array(n);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const wi = r.w[i] ?? 0;
      if (!wi) continue;
      const p = sigmoid((F[i] ?? 0) + (B[i] ?? 0) - (h[i] ?? 0) - theta);
      loss -= wi * (r.y[i] ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12));
      g[i] = wi * (p - (r.y[i] ?? 0));
    }
    // Adjoints of the forward (a) and backward (b) recurrences.
    const a = new Float64Array(n);
    let acc = 0;
    for (let i = n - 1; i >= 0; i--) {
      a[i] = acc = (g[i] ?? 0) + (i + 1 < n ? (d[i + 1] ?? 0) * acc : 0);
    }
    const bb = new Float64Array(n);
    acc = 0;
    for (let i = 0; i < n; i++) {
      bb[i] = acc = (g[i] ?? 0) + (i > 0 ? (d[i - 1] ?? 0) * acc : 0);
    }
    for (let i = 0; i < n; i++) {
      G[THETA] = (G[THETA] ?? 0) - (g[i] ?? 0);
      const k = r.cls[i] ?? 0;
      if (k === TAIL) continue;
      const dh = (a[i] ?? 0) + (bb[i] ?? 0) - (g[i] ?? 0);
      const dd =
        (i > 0 ? (a[i] ?? 0) * (F[i - 1] ?? 0) : 0) +
        (i + 1 < n ? (bb[i] ?? 0) * (B[i + 1] ?? 0) : 0);
      const du = dd * (d[i] ?? 0) * (1 - (d[i] ?? 0));
      G[HEAT + k] = (G[HEAT + k] ?? 0) + dh;
      G[DECAY + k] = (G[DECAY + k] ?? 0) + du;
      const o = r.cps[i] ? overrideIndex.get(r.cps[i] ?? 0) : undefined;
      if (o !== undefined) {
        G[DH + o] = (G[DH + o] ?? 0) + dh;
        G[DU + o] = (G[DU + o] ?? 0) + du;
      }
      const lk = LEFT + (r.left[i] ?? 0) * K + k;
      const rk = RIGHT + k * K + (r.right[i] ?? 0);
      G[lk] = (G[lk] ?? 0) + dh;
      G[rk] = (G[rk] ?? 0) + dh;
    }
    return loss;
  };

  const m = new Float64Array(P.length);
  const v = new Float64Array(P.length);
  const random = seededRandom(options.seed);
  const totalWeight = prepared.reduce((s, r) => s + r.weightSum, 0);
  const BATCH = 256;
  let step = 0;
  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const order = prepared.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
    }
    let epochLoss = 0;
    for (let start = 0; start < order.length; start += BATCH) {
      const G = new Float64Array(P.length);
      let batchWeight = 0;
      for (const idx of order.slice(start, start + BATCH)) {
        const r = prepared[idx];
        if (!r) continue;
        epochLoss += rowGrad(r, G);
        batchWeight += r.weightSum;
      }
      step++;
      const lr = options.learningRate * Math.min(1, step / 50);
      for (let j = 0; j < P.length; j++) {
        if (frozen.has(j) || (!G[j] && !m[j])) continue;
        let grad = (G[j] ?? 0) / Math.max(1, batchWeight);
        if (j < DH) grad += options.l2 * (P[j] ?? 0);
        m[j] = 0.9 * (m[j] ?? 0) + 0.1 * grad;
        v[j] = 0.999 * (v[j] ?? 0) + 0.001 * grad * grad;
        const mh = (m[j] ?? 0) / (1 - 0.9 ** step);
        const vh = (v[j] ?? 0) / (1 - 0.999 ** step);
        let x = (P[j] ?? 0) - (lr * mh) / (Math.sqrt(vh) + 1e-8);
        if (j >= DH && j < THETA) {
          x = Math.sign(x) * Math.max(0, Math.abs(x) - lr * options.l1);
        }
        P[j] = x;
      }
    }
    log(
      `[train] epoch ${epoch + 1}/${options.epochs} loss/char ${(epochLoss / totalWeight).toFixed(4)}`,
    );
  }

  const overrides = new Map<number, readonly [number, number]>();
  overrideCps.forEach((cp, i) => {
    const dh = P[DH + i] ?? 0;
    const du = P[DU + i] ?? 0;
    if (dh || du) overrides.set(cp, [dh, du]);
  });
  const sparse = (offset: number) => {
    const map = new Map<number, number>();
    for (let key = 0; key < KK; key++) {
      const x = P[offset + key] ?? 0;
      if (x) map.set(key, x);
    }
    return map;
  };
  const heat = P.slice(HEAT, HEAT + K);
  const decay = P.slice(DECAY, DECAY + K);
  return {
    heat,
    decay,
    overrides,
    left: sparse(LEFT),
    right: sparse(RIGHT),
    theta: P[THETA] ?? 0,
  };
}

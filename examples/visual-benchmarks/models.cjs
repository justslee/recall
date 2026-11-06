// Pure illustrative models. No DOM, storage, network or scheduling authority.
function yieldCurve({ shortBp = 20, longBp = 80 } = {}) {
  if (![shortBp, longBp].every(Number.isFinite))
    throw new TypeError("Yield changes must be finite basis points");

  const maturities = [2, 5, 10, 20, 30];
  const baseline = [0.6, 0.9, 1.3, 1.7, 2];
  const points = maturities.map((years, i) => {
    const fraction = Math.log(years / 2) / Math.log(30 / 2);
    const deltaBp = shortBp + fraction * (longBp - shortBp);
    return {
      years,
      baseline: baseline[i],
      scenario: baseline[i] + deltaBp / 100,
      deltaBp,
    };
  });
  const baselineSpreadBp = (baseline.at(-1) - baseline[0]) * 100;
  const spreadChangeBp = longBp - shortBp;
  const spreadBp = baselineSpreadBp + spreadChangeBp;
  const slope =
    Math.abs(spreadChangeBp) < 1e-9
      ? "Parallel shift"
      : spreadChangeBp > 0
        ? "Steepening"
        : "Flattening";
  const direction =
    shortBp <= 0 && longBp <= 0 && (shortBp < 0 || longBp < 0)
      ? "Bull"
      : shortBp >= 0 && longBp >= 0 && (shortBp > 0 || longBp > 0)
        ? "Bear"
        : "Mixed";
  return {
    points,
    shortBp,
    longBp,
    baselineSpreadBp,
    spreadBp,
    spreadChangeBp,
    slope,
    direction,
  };
}

function durationGap({
  assetDuration = 12,
  shockPct = 1,
  assets = 110,
  liabilities = 100,
  liabilityDuration = 18,
} = {}) {
  for (const [name, value] of Object.entries({
    assetDuration,
    shockPct,
    assets,
    liabilities,
    liabilityDuration,
  }))
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);

  if (
    assets <= 0 ||
    liabilities < 0 ||
    assetDuration < 0 ||
    liabilityDuration < 0
  )
    throw new RangeError(
      "Use positive assets and nonnegative liabilities and durations",
    );

  const shock = shockPct / 100;
  const matchedAssetDuration = (liabilities / assets) * liabilityDuration;
  const gapYears = assetDuration - matchedAssetDuration;
  const exposure = assets * assetDuration - liabilities * liabilityDuration;
  const assetChange = -assets * assetDuration * shock;
  const liabilityChange = -liabilities * liabilityDuration * shock;
  const baselineSurplus = assets - liabilities;
  const surplusChange = -exposure * shock;
  return {
    assets,
    liabilities,
    assetDuration,
    liabilityDuration,
    shockPct,
    matchedAssetDuration,
    gapYears,
    exposure,
    assetChange,
    liabilityChange,
    assetsAfter: assets + assetChange,
    liabilitiesAfter: liabilities + liabilityChange,
    baselineSurplus,
    surplusChange,
    surplusAfter: baselineSurplus + surplusChange,
  };
}

function referenceInitial(strongCache = false) {
  return {
    strongCache: Boolean(strongCache),
    owner: true,
    closed: false,
    temporary: false,
    collected: false,
    gcRuns: 0,
    phase: 0,
  };
}

function referenceView(state) {
  const reachable =
    !state.collected && (state.owner || state.strongCache || state.temporary);
  return {
    ...state,
    reachable,
    referenceAlive: !state.collected,
    lifetime: state.collected
      ? "Collected"
      : reachable
        ? "Strongly reachable"
        : "Unreachable · waiting for GC",
    referenceRead: state.collected
      ? "None"
      : "Object: caller temporarily owns it",
  };
}

function referenceTransition(state, action) {
  const next = { ...state };
  if (action === "reset") return referenceInitial();
  if (action === "close" && !next.collected) {
    next.closed = true;
    next.phase = Math.max(1, next.phase);
  } else if (action === "release-owner") {
    next.owner = false;
    next.phase = Math.max(2, next.phase);
  } else if (action === "read" && !next.collected) {
    next.temporary = true;
  } else if (action === "release-caller") {
    next.temporary = false;
  } else if (action === "collect") {
    next.gcRuns++;
    next.phase = 3;
    if (!next.owner && !next.strongCache && !next.temporary)
      next.collected = true;
  }
  return next;
}

module.exports = {
  yieldCurve,
  durationGap,
  referenceInitial,
  referenceView,
  referenceTransition,
};

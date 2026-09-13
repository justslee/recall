import React, { useState } from "react";

function Range({ label, value, min, max, step = 1, onChange, unit = "" }) {
  return (
    <label>
      {label}
      <strong>
        {value}
        {unit}
      </strong>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function Metrics({ items }) {
  return (
    <div className="lab-metrics">
      {items.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
const dollars = (n) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
function Bar({ parts, label }) {
  return (
    <div className="visual-bar" role="img" aria-label={label}>
      {parts.map(([name, value], i) => (
        <span
          key={name}
          style={{ flexGrow: Math.max(value, 0.01) }}
          className={"bar-part part-" + i}
        >
          <small>{name}</small>
          <strong>{value.toFixed(1)}%</strong>
        </span>
      ))}
    </div>
  );
}

function Binary() {
  const [bid, setBid] = useState(40);
  return (
    <>
      <Range
        label="NO bid"
        value={bid}
        min={1}
        max={99}
        unit="¢"
        onChange={setBid}
      />
      <Bar
        label={`NO bid ${bid} cents and equivalent YES ask ${100 - bid} cents sum to one dollar`}
        parts={[
          ["NO bid", bid],
          ["YES ask", 100 - bid],
        ]}
      />
      <Metrics
        items={[
          ["NO bid", `${bid}¢`],
          ["Equivalent YES ask", `${100 - bid}¢`],
          ["Complete pair", "$1.00"],
        ]}
      />
      <p>
        Move the bid: the equivalent ask moves the other way. This is a quote
        identity for complementary claims; execution fees affect your net cost.
      </p>
    </>
  );
}
function FX() {
  const [quote, setQuote] = useState(135);
  const cost = 1500000 / quote;
  return (
    <>
      <Range
        label="USD/JPY at repayment"
        value={quote}
        min={100}
        max={180}
        unit=" ¥/$"
        onChange={setQuote}
      />
      <Metrics
        items={[
          ["Yen principal", "¥1,500,000"],
          ["Dollars to repay", dollars(cost)],
          ["Change from $10,000", dollars(cost - 10000)],
        ]}
      />
      <div className="fx-direction">
        <span>Stronger yen</span>
        <span>Lower USD/JPY → more dollars to repay</span>
        <span>Weaker yen</span>
      </div>
      <p>
        The yen debt is fixed. Divide it by yen per dollar. Interest and fees
        are excluded; the starting quote was 150.
      </p>
    </>
  );
}
function Rates() {
  const [funding, setFunding] = useState(0.5),
    [asset, setAsset] = useState(4),
    [fx, setFx] = useState(150);
  const proceeds = 10000 * (1 + asset / 100),
    repay = (1500000 * (1 + funding / 100)) / fx;
  return (
    <>
      <div className="lab-controls">
        <Range
          label="Yen funding rate"
          value={funding}
          min={0}
          max={5}
          step={0.25}
          unit="%"
          onChange={setFunding}
        />
        <Range
          label="Dollar asset return"
          value={asset}
          min={0}
          max={8}
          step={0.25}
          unit="%"
          onChange={setAsset}
        />
      </div>
      <Range
        label="Ending USD/JPY"
        value={fx}
        min={110}
        max={180}
        unit=" ¥/$"
        onChange={setFx}
      />
      <Metrics
        items={[
          ["Rate differential", `${(asset - funding).toFixed(2)} pp`],
          ["Dollar proceeds", dollars(proceeds)],
          ["After yen repayment", dollars(proceeds - repay)],
        ]}
      />
      <p>
        One-year example: borrow ¥1.5m, convert at 150, invest $10,000. Annual
        simple returns; no fees or hedging. The rate gap affects carry, but it
        does not determine the future exchange rate.
      </p>
    </>
  );
}
function Kelly() {
  const [base, setBase] = useState(20),
    [cv, setCv] = useState(0.55);
  const size = base * Math.max(0, 1 - cv);
  return (
    <>
      <div className="lab-controls">
        <Range
          label="Baseline Kelly allocation"
          value={base}
          min={0}
          max={50}
          unit="%"
          onChange={setBase}
        />
        <Range
          label="Edge coefficient of variation"
          value={cv}
          min={0}
          max={1}
          step={0.01}
          onChange={setCv}
        />
      </div>
      <Bar
        label={`Allocate ${size.toFixed(1)} percent and leave ${(100 - size).toFixed(1)} percent unallocated`}
        parts={[
          ["Allocated", size],
          ["Unallocated", 100 - size],
        ]}
      />
      <Metrics
        items={[
          ["Baseline", `${base}%`],
          ["Multiplier", (1 - cv).toFixed(2)],
          ["Adjusted size", `${size.toFixed(2)}%`],
        ]}
      />
      <p>
        This visual applies the shrinkage heuristic in the imported card:
        baseline × max(0, 1 − CV). It illustrates that rule; it is not a
        guarantee of optimal sizing.
      </p>
    </>
  );
}
function Duration() {
  const [move, setMove] = useState(20),
    [duration, setDuration] = useState(4.5);
  const price = 100 * (1 - (duration * move) / 10000);
  const x = 40 + (move + 100) * 2.4,
    y = 120 - (price - 100) * 10;
  return (
    <>
      <div className="lab-controls">
        <Range
          label="Yield change"
          value={move}
          min={-100}
          max={100}
          unit=" bp"
          onChange={setMove}
        />
        <Range
          label="Modified duration"
          value={duration}
          min={0}
          max={10}
          step={0.5}
          onChange={setDuration}
        />
      </div>
      <svg
        className="duration-chart"
        viewBox="0 0 560 250"
        role="img"
        aria-label={`First-order bond price estimate ${price.toFixed(2)} for ${move} basis points and duration ${duration}`}
      >
        <line x1="40" y1="120" x2="520" y2="120" className="axis" />
        <line x1="280" y1="15" x2="280" y2="225" className="axis" />
        <path
          d={`M40 ${120 - duration * 10} L520 ${120 + duration * 10}`}
          className="price-line"
        />
        <circle cx={x} cy={y} r="7" />
        <text x="40" y="244">
          −100 bp
        </text>
        <text x="265" y="244">
          0
        </text>
        <text x="466" y="244">
          +100 bp
        </text>
        <text x="290" y="112">
          $100
        </text>
      </svg>
      <Metrics
        items={[
          ["Starting price", "$100.00"],
          ["Estimated change", dollars(price - 100)],
          ["Estimated price", dollars(price)],
        ]}
      />
      <p>
        Price change ≈ −duration × decimal yield change × starting price. The
        line is a first-order approximation; it excludes convexity.
      </p>
    </>
  );
}
export function InteractiveLab({ type }) {
  const map = {
    binary: ["Explore complementary prices", Binary],
    fx: ["Explore yen repayment", FX],
    rates: ["Explore carry and exchange rates", Rates],
    kelly: ["Explore uncertainty and allocation", Kelly],
    duration: ["Explore bond price sensitivity", Duration],
  };
  if (!map[type]) return null;
  const [title, Component] = map[type];
  return (
    <details className="explore interactive-example">
      <summary>{title}</summary>
      <section className="lab">
        <span className="eyebrow">CHANGE A VALUE · FOLLOW THE EFFECT</span>
        <Component />
      </section>
    </details>
  );
}

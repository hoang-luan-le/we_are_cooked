"use client";

import { type PointerEvent, useRef, useState } from "react";

type Point = { time: string; errorRate: number; ordersPerMinute: number; event?: string };

const W = 1000, H = 280, TOP = 16, BOTTOM = 8, CEILING = 35;

/** Error rate across the scenario. Points are evenly spaced by event, and each time is labeled. */
export function IncidentTrace({ points, initial }: { points: Point[]; initial: number }) {
  const [active, setActive] = useState(initial);
  const plot = useRef<HTMLDivElement>(null);
  const x = (index: number) => ((index + 0.5) / points.length) * W;
  const y = (rate: number) => TOP + (1 - rate / CEILING) * (H - TOP - BOTTOM);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index)} ${y(point.errorRate)}`).join(" ");
  const area = `${line} L${x(points.length - 1)} ${H} L${x(0)} ${H} Z`;
  const current = points[active];

  function follow(event: PointerEvent<HTMLDivElement>) {
    const box = plot.current?.getBoundingClientRect();
    if (!box) return;
    plot.current?.style.setProperty("--px", `${event.clientX - box.left}px`);
    plot.current?.style.setProperty("--py", `${event.clientY - box.top}px`);
  }

  return (
    <>
      <dl className="trace-readout">
        <div><dt>Time</dt><dd className="trace-time">{current.time}</dd></div>
        <div><dt>Checkout errors</dt><dd>{current.errorRate}%</dd></div>
        <div><dt>Successful orders</dt><dd>{current.ordersPerMinute}<small>/min</small></dd></div>
      </dl>
      <div ref={plot} className="trace-plot" onPointerMove={follow}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="trace-axis" x1="0" x2={W} y1={y(CEILING / 2)} y2={y(CEILING / 2)} />
          <path className="trace-area" d={area} />
          <path className="trace-line" d={line} />
        </svg>
        <div className="trace-points" style={{ "--n": points.length } as React.CSSProperties}>
          {points.map((point, index) => (
            <button key={point.time} type="button" className="trace-point" aria-pressed={index === active}
              aria-label={`${point.time}: ${point.errorRate}% checkout errors, ${point.ordersPerMinute} orders per minute${point.event ? `. ${point.event}` : ""}`}
              onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}>
              <i style={{ "--y": `${(y(point.errorRate) / H) * 100}%` } as React.CSSProperties} />
            </button>
          ))}
        </div>
      </div>
      <ol className="trace-ticks" style={{ "--n": points.length } as React.CSSProperties} aria-hidden="true">
        {points.map(point => <li key={point.time} className={point.event ? "is-event" : undefined}><time>{point.time}</time>{point.event ? <strong>{point.event}</strong> : null}</li>)}
      </ol>
    </>
  );
}

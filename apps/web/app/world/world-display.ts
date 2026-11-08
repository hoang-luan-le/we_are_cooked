// What an in-world screen shows. The same object feeds the HTML panel, so the two cannot drift apart.
export type DisplayContent = {
  eyebrow: string;
  title: string;
  lines: string[];
  footer?: string;
  /** Marks the data source on the screen, for example "Fixture" or "Local API". */
  badge?: string;
  dark?: boolean;
};

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Large type and few lines, so the projector reads from a seat at about 4 metres. */
export function drawDisplay(ctx: CanvasRenderingContext2D, content: DisplayContent) {
  const { width, height } = ctx.canvas;
  const bg = content.dark ? "#10151d" : "#f4f2ec";
  const ink = content.dark ? "#f4f6f8" : "#16202e";
  const muted = content.dark ? "#a9b4c2" : "#4b5563";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1d2b45";
  ctx.fillRect(0, 0, width, 70);
  ctx.textBaseline = "top";
  ctx.font = "600 30px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(content.eyebrow, 30, 18);
  if (content.badge) {
    ctx.font = "600 22px 'Segoe UI', system-ui, sans-serif";
    const w = ctx.measureText(content.badge).width + 28;
    ctx.fillStyle = "#e7a34d";
    ctx.fillRect(width - w - 24, 16, w, 38);
    ctx.fillStyle = "#14181f";
    ctx.fillText(content.badge, width - w - 10, 23);
  }
  ctx.font = "700 50px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = ink;
  let y = 92;
  for (const line of wrap(ctx, content.title, width - 60).slice(0, 2)) {
    ctx.fillText(line, 30, y);
    y += 60;
  }
  y += 8;
  ctx.font = "400 34px 'Segoe UI', system-ui, sans-serif";
  const bottom = height - (content.footer ? 62 : 16);
  outer: for (const text of content.lines) {
    ctx.fillStyle = ink;
    for (const line of wrap(ctx, text, width - 60)) {
      if (y + 42 > bottom) break outer;
      ctx.fillText(line, 30, y);
      y += 42;
    }
    y += 8;
  }
  if (content.footer) {
    ctx.font = "600 28px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = muted;
    ctx.fillText(content.footer, 30, height - 48);
  }
}

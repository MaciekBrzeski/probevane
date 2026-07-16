import { packed } from '../../util/theme.ts';
import type { ChecksReport } from '../../util/checks-shape.ts';

// Checks tab renderer — fetches the /checks gate scoreboard and draws it in
// the control center's visual language: ring gauges for the headline scores,
// status lamps for pass/fail gates (reserved status colors + a glyph, never
// color alone), single-hue bars for crowding magnitude, and the fixture-eval
// pass-rate sparkline. Split out of main.tsx to keep it under the size bar.

const $ = (id: string) => document.getElementById(id)!;

/** Gauge arc value: a perfect 1.0 degenerates into a zero-length full-circle
 *  path in the ring widget (start == end), so a 100% score rendered as a dot —
 *  clamp just under full and let the label carry the exact number. */
const ring = (v: number) => Math.min(v, 0.999);

/** One gate lamp: reserved status color + glyph + label — never color alone. */
function lamp(ok: boolean, label: string, value: string): Node {
  const tone = ok ? 'ok' : 'err';
  return (
    <div class="lamp" style={`border-left-color:var(--${tone})`}>
      <span style={`color:var(--${tone})`}>{ok ? '✓' : '✗'}</span> {label}{' '}
      <span class="muted">{value}</span>
    </div>
  );
}

/** The muted "no artifact" lamp — absence of data is not a pass. */
function lampAbsent(label: string, hint: string): Node {
  return (
    <div class="lamp" style="border-left-color:var(--line)">
      <span class="muted">—</span> {label} <span class="muted">{hint}</span>
    </div>
  );
}

/** The gates column: strict quality, pyramid, cycles, doc backlog, coverage. */
function gateLamps(d: ChecksReport): Node {
  const cov = d.coverage;
  return (
    <div>
      <h3>gates</h3>
      {lamp(d.quality.errors === 0, 'quality --strict', `${d.quality.errors} err / ${d.quality.warns} warn`)}
      {lamp(
        d.pyramid.violations === 0,
        'pyramid model',
        `${d.pyramid.violations} violation(s) · ${d.pyramid.features} pyramids on ` +
          `${d.pyramid.shared} shared / ${d.pyramid.glue} glue`,
      )}
      {lamp(d.cycles === 0, 'dir cycles', String(d.cycles))}
      {lamp(d.quality.docBacklog === 0, 'doc backlog (pre-ratchet)', `${d.quality.docBacklog} undocumented`)}
      {cov
        ? lamp(
            cov.statements >= 90 && cov.branches >= 90,
            'coverage floors',
            `${cov.statements}% stmts · ${cov.branches}% branch · ${cov.functions}% fn`,
          )
        : lampAbsent('coverage', 'no artifact — run npm run coverage')}
      {d.mutation
        ? lamp(
            d.mutation.score >= 0.6,
            'mutation score',
            `${Math.round(d.mutation.score * 100)}% · ${d.mutation.survived}/${d.mutation.total} survived` +
              `${d.mutation.sampled ? ' (sampled)' : ''} · ${ageOf(d.mutation.at)}`,
          )
        : lampAbsent('mutation score', 'no artifact — run probevane mutation .')}
    </div>
  );
}

/** Human age of an ISO timestamp for the artifact staleness hint. */
function ageOf(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '?';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/** Crowding bars (single hue = magnitude) + the eval pass-rate sparkline. */
function trendColumn(d: ChecksReport): Node {
  const maxCrowd = Math.max(1, ...d.crowding.map((c) => c.files));
  const last = d.evalHistory[d.evalHistory.length - 1];
  return (
    <div>
      <h3>crowded dirs (over the file cap)</h3>
      {d.crowding.length
        ? d.crowding.map((c) => (
            <div class="checks-bar-row">
              <span class="checks-bar-label">{c.dir}</span>
              <div class="checks-bar" style={`width:${Math.round((c.files / maxCrowd) * 100)}%`}></div>
              <span class="muted">{c.files}</span>
            </div>
          ))
        : <div class="muted">none — every dir under the cap</div>}
      <h3 style="margin-top:14px">fixture eval — pass rate per run</h3>
      {d.evalHistory.length
        ? <Spark
            points={d.evalHistory.map((e) => e.ratio)}
            label={`last ${d.evalHistory.length} runs · latest ${Math.round((last?.ratio ?? 0) * 100)}%`}
            accent={packed('ok')}
          />
        : <div class="muted">no improvement-log yet</div>}
    </div>
  );
}

/** Fetch /checks and build the gate scoreboard into #checks-body. */
export async function loadChecks(): Promise<void> {
  const body = $('checks-body');
  const d = (await fetch('/checks')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as ChecksReport | null;
  if (!d) {
    body.textContent = 'checks endpoint unavailable';
    return;
  }
  $('checksmeta').textContent = `${d.quality.files} files · ${d.quality.functions} functions`;
  body.classList.remove('muted');
  body.replaceChildren(
    <>
      <div class="checks-gauges">
        <Gauge value={ring(d.quality.grade / 100)} label={`quality ${d.quality.grade}/100`} accent={packed('ok')} />
        <Gauge value={ring(d.pyramid.score / 100)} label={`pyramid ${d.pyramid.score}/100`} accent={packed('acc')} />
        {d.coverage
          ? <Gauge value={ring(d.coverage.statements / 100)} label="coverage (stmts)" accent={packed('mag')} />
          : null}
      </div>
      <div class="checks-cols">
        {gateLamps(d)}
        {trendColumn(d)}
      </div>
    </>,
  );
}

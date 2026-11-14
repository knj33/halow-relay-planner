import { modelAssumptions } from '../engine';
import type { BodyId, TerrainMeta } from '../engine';

export function AssumptionsPanel({ body, terrain }: { body: BodyId; terrain: TerrainMeta | null }) {
  return (
    <div className="assumptions">
      <div className="state-card neutral">
        <h3>Read this before trusting a number</h3>
        <p>This is a planning prototype. Its outputs are first-order estimates on {terrain && !terrain.synthetic ? 'resampled public elevation data' : 'synthetic terrain'}, intended to compare options and show where links are likely to fail, not to certify that a link will work.</p>
      </div>
      {modelAssumptions(body, terrain).map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3>{g.title}</h3>
          <ul>
            {g.items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

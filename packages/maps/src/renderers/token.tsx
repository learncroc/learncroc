/** The learner's token, parked beside the stop they last touched (MapView animates the travel). */
import { TokenArt } from "./glyphs";
import { type DrawModel, lineColor } from "./kit";

/** Offset from the stop centre so the token sits up and to the left of the glyph. */
export const TOKEN_OFFSET = { x: -20, y: -22 } as const;

export function TokenMarker({ m }: { m: DrawModel }) {
  const at = m.props.tokenAt;
  const n = at ? m.scene.byId.get(at) : undefined;
  if (!n) return null;
  return (
    <g
      data-layer="token"
      data-token-at={n.id}
      transform={`translate(${n.x + TOKEN_OFFSET.x} ${n.y + TOKEN_OFFSET.y}) scale(0.85)`}
    >
      <TokenArt kind={m.props.theme.token} ink={m.colors.ink} accent={lineColor(m, n.color)} ground={m.colors.ground} />
    </g>
  );
}

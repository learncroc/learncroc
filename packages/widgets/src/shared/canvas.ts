/**
 * How much room a widget wants on the card modal's canvas. Most widgets fit the default modal canvas
 * (about 700 × 340 px, the player's `layout="modal"`); the few that draw a tall figure say so here,
 * and the player gives them a taller canvas (or the full-width split layout) instead of squeezing them.
 */
export interface WidgetCanvas {
  /** The smallest canvas height (px, padding included) at which the widget lays out without scrolling. */
  minHeight?: number;
  /** The widget reads best with more height than width allows in the modal (a diagram, a scene). */
  prefersTall?: boolean;
}

/** The card modal's default canvas: width × height in px, padding included. */
export const MODAL_CANVAS = { width: 700, height: 340 } as const;

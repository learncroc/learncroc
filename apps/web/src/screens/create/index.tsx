/**
 * Create screens: the hub with the article-map gallery, the "Map an article" intake and
 * the live building view that hands off at card 1.
 */
import { Hub } from "./Hub";
import { Intake } from "./Intake";
import { Surveying } from "./Surveying";

/** /create — Create hub with the article-map gallery. */
export function CreateScreen() {
  return <Hub />;
}

/** /create/pocket — Map an article. */
export function PocketIntakeScreen() {
  return <Intake />;
}

/** /create/pocket/:job — the map building, with Start card 1. */
export function PocketJobScreen() {
  return <Surveying />;
}

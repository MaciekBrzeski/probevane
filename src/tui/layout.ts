// The layered-DAG layout now lives in @facet/core (shared with the browser
// NodeGraph). Re-exported so `./layout.js` importers are unchanged.
export {
  layoutDag, chainToDag,
  type LayoutNode, type PlacedNode, type PlacedEdge, type Layout,
} from '@facet/core';

// @facet/core — pure vector drawing engine surface. No DOM, no ANSI.
export type { Color, Style } from './style';
export { rgb, hex, mix, glow, pulse } from './style';
export type { Painter, Caps, Pt } from './painter';
export type { Rect, Span } from './geom';
export { spanToBox, spanToCss, clamp } from './geom';
export type { LayoutNode, PlacedNode, PlacedEdge, Layout } from './layout';
export { layoutDag, chainToDag } from './layout';
export * from './widgets/index';

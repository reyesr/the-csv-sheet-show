export const DEFAULT_COLUMN_WIDTH = 192;
export const HEADER_HEIGHT = 28;
export const MIN_COLUMN_WIDTH = 32;
export const OVERSCAN_ROWS = 20;
export const PAGE_MOVE_RATIO = 0.6;
export const ROW_HEIGHT = 26;
export const ROW_NUMBER_COLUMN_WIDTH = 64;

// Chromium stores layout positions as a 32-bit fixed-point LayoutUnit (1/64-px precision), so element
// heights saturate at 2^31 / 64 = 33,554,432 device px; a 1:1 spacer past this is silently clamped,
// making the tail of very large CSVs unreachable. Cap the spacer below it (safe to ~DPR 3.3, and under
// Firefox's ~17.9M limit), then map scroll position <-> content position. See docs/virtual-scroll-row-limit.md.
export const MAX_SCROLL_HEIGHT = 10_000_000;

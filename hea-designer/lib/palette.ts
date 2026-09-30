// Per-element series colors (by selection order). Chosen to read on both paper and dark themes.
export const ATOM_PALETTE = ["#2F6FD6", "#2E9D6B", "#D08A1C", "#8A5CC9", "#D0453C", "#1F9FB5", "#B08F12", "#C2548F", "#5B6B7F", "#6E8F2E"];

export const atomColor = (i: number) => ATOM_PALETTE[i % ATOM_PALETTE.length];

/**
 * The accessible tail palette from docs/schema.md.
 *
 * Colours are chosen for contrast against a dark map and to stay separable for
 * the common colour-vision deficiencies. Goalpost 1 has one player so this is
 * mostly a constant; the claim/release logic arrives with lobbies in Goalpost 2.
 */

import type { PlayerColor } from '@shared/types';

export interface PaletteEntry {
  name: string;
  hex: PlayerColor;
  note: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: 'Cyan', hex: '#00E5FF', note: 'High contrast on dark map. Distinct for deuteranopia and protanopia.' },
  { name: 'Yellow', hex: '#FFE600', note: 'High luminance. Visible to all common colourblind types.' },
  { name: 'Magenta', hex: '#FF00FF', note: 'Distinct from cyan and yellow. Avoid pairing with red for deuteranopes.' },
  { name: 'Orange', hex: '#FF6D00', note: 'Distinguishable from yellow by hue shift. High contrast on dark backgrounds.' },
  { name: 'Lime', hex: '#AEEA00', note: 'Distinct from cyan. May be confused with yellow by tritanopes.' },
  { name: 'White', hex: '#FFFFFF', note: 'Maximum contrast. Reserved as fallback / host indicator.' },
] as const;

export const DEFAULT_COLOR: PlayerColor = '#00E5FF';

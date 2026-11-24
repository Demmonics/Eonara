import type { DynamicPalette } from './palette';

export interface ExtractMessage {
  id: number;
  dataUrl: string;
  artworkHash?: string;
}

export interface PaletteMessage {
  id: number;
  palette?: DynamicPalette;
}

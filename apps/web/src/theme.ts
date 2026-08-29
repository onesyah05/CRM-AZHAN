const HEX_COLOR = /^#?([\da-f]{6})$/i;

export function getBrandForeground(color: string): '#18181B' | '#FFFFFF' {
  const match = HEX_COLOR.exec(color.trim());
  if (!match) return '#FFFFFF';

  const hex = match[1]!;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? '#18181B' : '#FFFFFF';
}

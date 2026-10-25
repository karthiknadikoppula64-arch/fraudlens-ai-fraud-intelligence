import React from 'react';

/**
 * Recharts colours legend labels with the series colour by default. Light series colours
 * (#3988FF blue, violet) fail text contrast on white, so legend text uses the theme's muted
 * text colour; the swatch keeps the series colour.
 */
export const legendText = (value: unknown) => <span className="cs-muted">{String(value)}</span>;

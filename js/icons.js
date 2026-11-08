// Small inline SVG icons (24x24, stroked with currentColor).

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pen: svg('<path d="M4 20l1.2-4.6L16 4.6a1.4 1.4 0 0 1 2 0l1.4 1.4a1.4 1.4 0 0 1 0 2L8.6 18.8z"/><path d="M14.5 6l3.5 3.5"/>'),
  pencil: svg('<path d="M4 20l1.5-5L15 5.5l3.5 3.5L9 18.5z"/><path d="M5.5 15l3.5 3.5"/><path d="M13 7.5l3.5 3.5"/>'),
  marker: svg('<path d="M9.5 14.5l-4 4.5h5l1.5-1.5"/><path d="M8 13l7.5-9 4.5 4-8 8.5z"/>'),
  airbrush: svg('<circle cx="6" cy="6" r="1"/><circle cx="10" cy="4.5" r="1"/><circle cx="9" cy="9" r="1"/><circle cx="4.5" cy="10" r="1"/><path d="M12 12l8 8"/><path d="M14.5 10.5l-4 4"/>'),
  eraser: svg('<path d="M4 15.5l8.5-8.5a2 2 0 0 1 2.8 0l3.7 3.7a2 2 0 0 1 0 2.8L13 19.5H8z"/><path d="M9 10.5l5.5 5.5"/><path d="M8 19.5h12"/>'),
  fill: svg('<path d="M4.5 11.5L11 5l7 7-6.5 6.5a1.5 1.5 0 0 1-2.1 0l-4.9-4.9a1.5 1.5 0 0 1 0-2.1z"/><path d="M4.5 12h13"/><path d="M20 15s1.8 2.3 1.8 3.6a1.8 1.8 0 0 1-3.6 0c0-1.3 1.8-3.6 1.8-3.6z"/>'),
  eyedropper: svg('<path d="M14.5 4.5l5 5-2 2-5-5z"/><path d="M13.5 8.5L5 17v2.5h2.5L16 11"/>'),
  hand: svg('<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-5-2.7l-2.4-3.7a1.5 1.5 0 0 1 2.4-1.8L8 13.5"/>'),
  eye: svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 6.1c.5-.1.9-.1 1.4-.1 6.4 0 10 6 10 6a17 17 0 0 1-3 3.6"/><path d="M6.4 7.3A16 16 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.4-1"/>'),
};

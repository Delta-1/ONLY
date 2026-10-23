const icons = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.5 11h11l2-8H6"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  tag: '<path d="M20.6 13.6 11 23.2l-9-9V4h10.2z"/><circle cx="7" cy="9" r="2"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
  store:
    '<path d="M3 9 5 3h14l2 6M5 13v8h14v-8"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
  wallet:
    '<rect x="2" y="5" width="20" height="15" rx="2"/><path d="M16 13h6M2 9h16"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
  badge:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h3M15 12h3M7 16h10"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l-2.6 2.6a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.3 1.6h-3.4A2 2 0 0 0 9 19.4a2 2 0 0 0-2.2.4l-2.6-2.6a2 2 0 0 0 .4-2.2A2 2 0 0 0 3 13.7v-3.4A2 2 0 0 0 4.6 9a2 2 0 0 0-.4-2.2l2.6-2.6A2 2 0 0 0 9 4.6 2 2 0 0 0 10.3 3h3.4A2 2 0 0 0 15 4.6a2 2 0 0 0 2.2-.4l2.6 2.6A2 2 0 0 0 19.4 9a2 2 0 0 0 1.6 1.3v3.4A2 2 0 0 0 19.4 15Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.4-4.4"/>',
  filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>',
  upload: '<path d="M12 21V9m0 0 5 5m-5-5-5 5M5 3h14"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3"/>',
  transfer: '<path d="m17 3 4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
  monitor:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  receipt:
    '<path d="M4 2v20l4-2 4 2 4-2 4 2V2l-4 2-4-2-4 2Z"/><path d="M8 9h8M8 13h6"/>',
};
export const svg = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n] || icons.box}</svg>`;
icons.globe =
  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>';
icons.smartphone =
  '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4M11 18h2"/>';
icons.dots =
  '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>';
icons.laptop =
  '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 20h20M8 20v-1h8v1"/>';

const paths={
  mind:'<path d="M25 52c-8-15 1-31 17-31 9 0 15 6 18 13 3-7 9-13 18-13 16 0 25 16 17 31-6 11-22 24-35 32-13-8-29-21-35-32Z"/><path d="M33 51h16l7-12 8 25 8-13h15"/>',
  attention:'<rect x="13" y="30" width="39" height="48" rx="9"/><rect x="68" y="30" width="39" height="48" rx="9"/><circle cx="33" cy="43" r="5"/><path d="m18 68 13-15 16 18m26-3 13-15 16 18M57 54h6"/>',
  disengage:'<circle cx="28" cy="58" r="14"/><circle cx="94" cy="58" r="14"/><path d="M38 31q22-18 45 1m-10-2 11 2-2-11M82 86q-22 15-45-1m10 2-11-2 2 11"/>',
  reward:'<circle cx="32" cy="57" r="20"/><rect x="72" y="37" width="39" height="39" rx="8"/><path d="m58 18 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/>',
  load:'<rect x="20" y="18" width="80" height="83" rx="16"/><path d="M36 43h18m-9-9v18m23-10h15M37 73l13 13m-13 0 13-13m20 5h15m-15 8h15"/>',
  recovery:'<path d="M13 62h19l9-23 15 43 12-30 8 10h31"/><path d="M20 27q40-22 80 0M20 95q40 22 80 0"/>',
  calibration:'<circle cx="60" cy="60" r="30"/><circle cx="60" cy="60" r="8"/><path d="M60 12v12m0 72v12M12 60h12m72 0h12"/>'
};
export function art(kind,cls=''){return `<svg class="mind-art ${cls}" viewBox="0 0 120 120" aria-hidden="true"><circle class="art-disc" cx="60" cy="60" r="55"/><g>${paths[kind]||paths.recovery}</g></svg>`;}

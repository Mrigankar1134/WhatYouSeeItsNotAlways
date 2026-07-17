// Centralised copy + emotion mapping for The Garden Beyond Seasons.

export const COPY = {
  loading: 'The garden is waking.',
  enterScroll: 'Scroll to enter',
  enterSwipe: 'Swipe gently to enter',
  saved: 'Saved in this garden',
  taken: 'The memory has taken root.',
  gathered: 'The garden has been gathered safely.',
  remain: 'The garden will remain.',
  emptyArchive: 'Nothing has been planted yet. The soil is ready whenever you are.',
  photoPrivacy: 'This photograph never leaves your device.',
};

// Zones the calm camera drifts through. `t` is normalised path position 0..1.
export const ZONES = [
  { id: 'gate',    name: 'The Gate',           t: 0.00 },
  { id: 'entrance',name: 'The Entrance',       t: 0.14, title: 'The Entrance', sub: 'Every garden begins with something carried quietly.' },
  { id: 'garden',  name: 'The Memory Garden',  t: 0.36, title: 'The Memory Garden', sub: 'Plant what you wish to keep.' },
  { id: 'pond',    name: 'The Reflection Pond', t: 0.58, title: 'The Reflection Pond', sub: 'What returns is not always asking to be held.' },
  { id: 'bench',   name: 'The Quiet Bench',    t: 0.72, title: 'The Quiet Bench', sub: 'Sit for a while.' },
  { id: 'bridge',  name: 'The Forgotten Bridge', t: 0.86, title: 'The Forgotten Bridge', sub: 'Some roads remain unfinished.' },
  { id: 'meadow',  name: 'The Exit Meadow',    t: 1.00, title: 'The Exit Meadow', sub: 'Some stories don’t end. They simply stop being written.' },
];

// Emotion -> flower identity. Colours pulled from the brief's palette.
export const EMOTIONS = {
  joy:       { label: 'Joy',       flower: 'Yellow Daisy',   primary: '#E8C85A', secondary: '#FFF0A5', glow: '#F7E6A0', remains: 'a lightness' },
  love:      { label: 'Love',      flower: 'Rose',           primary: '#A95463', secondary: '#D98A91', glow: '#E9B2B7', remains: 'a warmth' },
  comfort:   { label: 'Comfort',   flower: 'Lavender',       primary: '#87739E', secondary: '#B6A5C5', glow: '#CEC1D8', remains: 'a stillness' },
  adventure: { label: 'Adventure', flower: 'Sunflower',      primary: '#D5A12B', secondary: '#F0CF65', glow: '#F5DEA0', remains: 'a pull forward' },
  goodbye:   { label: 'Goodbye',   flower: 'Autumn Flower',  primary: '#B66F43', secondary: '#D9A071', glow: '#E7C0A2', remains: 'a soft ache' },
  silence:   { label: 'Silence',   flower: 'White Lily',     primary: '#E9E8E0', secondary: '#C9D2C8', glow: '#F7F6F0', remains: 'nothing, and everything' },
};

export const EMOTION_ORDER = ['joy', 'love', 'comfort', 'adventure', 'goodbye', 'silence'];

// One world-day lasts 24 real minutes.
export const DAY_LENGTH_MS = 24 * 60 * 1000;

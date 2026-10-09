// Fictional movie data and mock catalog matching Figma FlashSeat design

export const MOVIES = [
  {
    id: 'beyond_the_blue',
    title: 'Beyond the Blue',
    genre: ['Sci-Fi', 'Adventure'],
    duration: '2h 28m',
    rating: 4.9,
    reviewCount: '14.8k',
    formats: ['IMAX 2D', '4DX', 'Dolby Atmos'],
    language: 'English',
    releaseType: 'now_showing',
    priceFrom: 250,
    poster: '/posters/beyond_the_blue.png',
    banner: '/posters/hero_banner.png',
    tagline: 'Gravity is just a suggestion.',
    description: 'An exploratory deep-space crew discovers an unmapped exoplanet where oceans defy gravity and time dilates with every lunar tide.',
    director: 'Aiden Vance',
    cast: ['Marcus Kane', 'Elena Rostova', 'David Chen'],
    cert: 'UA 13+'
  },
  {
    id: 'shadows_in_the_mist',
    title: 'Shadows in the Mist',
    genre: ['Thriller', 'Mystery'],
    duration: '2h 12m',
    rating: 4.7,
    reviewCount: '9.2k',
    formats: ['2D', 'Dolby Cinema'],
    language: 'English',
    releaseType: 'now_showing',
    priceFrom: 220,
    poster: '/posters/shadows_in_the_mist.png',
    tagline: 'Some secrets should remain buried in the fog.',
    description: 'A secluded mountain observatory receives an encrypted sequence from an abandoned weather bunker thought destroyed decades ago.',
    director: 'Claire Sterling',
    cast: ['Julian Mercer', 'Nora Hayes', 'Simon Drake'],
    cert: 'UA 16+'
  },
  {
    id: 'streets_of_neon',
    title: 'Streets of Neon',
    genre: ['Action', 'Crime'],
    duration: '1h 58m',
    rating: 4.8,
    reviewCount: '18.1k',
    formats: ['IMAX 2D', '4DX'],
    language: 'English',
    releaseType: 'now_showing',
    priceFrom: 280,
    poster: '/posters/streets_of_neon.png',
    tagline: 'High-speed justice on cybernetic asphalt.',
    description: 'An elite tactical extraction driver is framed during a clandestine corporate data transfer across a glowing rain-soaked metropolis.',
    director: 'Ren Tanaka',
    cast: ['Koa Bradley', 'Maya Lin', 'Viktor Ramos'],
    cert: 'A 18+'
  },
  {
    id: 'silent_woods',
    title: 'Silent Woods',
    genre: ['Adventure', 'Drama'],
    duration: '2h 05m',
    rating: 4.6,
    reviewCount: '7.4k',
    formats: ['2D', '3D'],
    language: 'English',
    releaseType: 'now_showing',
    priceFrom: 200,
    poster: '/posters/silent_woods.png',
    tagline: 'Nature remembers what civilization forgot.',
    description: 'Two estranged naturalists journey into the uncharted heart of the Taiga forest following rumors of an untouched biospheric sanctuary.',
    director: 'Hannah Lindqvist',
    cast: ['Oliver Thorne', 'Astrid Blom', 'Erik Larsen'],
    cert: 'U'
  },
  {
    id: 'cyber_pulse',
    title: 'Cyber Pulse',
    genre: ['Sci-Fi', 'Action'],
    duration: '2h 20m',
    rating: 4.9,
    reviewCount: '22.5k',
    formats: ['IMAX 2D', '3D', '4DX'],
    language: 'English',
    releaseType: 'coming_soon',
    priceFrom: 300,
    poster: '/posters/cyber_pulse.png',
    tagline: 'The network is alive. And it is waking up.',
    description: 'A rogue neural programmer uncovers an autonomous synthetic intelligence thriving silently inside the global power infrastructure.',
    director: 'Kenji Sato',
    cast: ['Zack Mercer', 'Talia Frost', 'Arjun Mehta'],
    cert: 'UA 16+'
  },
  {
    id: 'celestial_odyssey',
    title: 'Celestial Odyssey',
    genre: ['Animation', 'Fantasy'],
    duration: '1h 45m',
    rating: 4.8,
    reviewCount: '11.3k',
    formats: ['3D', 'Dolby Atmos'],
    language: 'English',
    releaseType: 'coming_soon',
    priceFrom: 240,
    poster: '/posters/celestial_odyssey.png',
    tagline: 'Sail across the starry sky.',
    description: 'A young stargazing orphan constructs a solar-glider to rescue constellation spirits trapped behind the eclipse curtain.',
    director: 'Marie Laurent',
    cast: ['Voice: Chloe Ray', 'Voice: Samuel Sterling'],
    cert: 'U'
  }
];

export const GENRES = [
  'All Genres',
  'Action',
  'Adventure',
  'Sci-Fi',
  'Thriller',
  'Mystery',
  'Animation',
  'Drama',
  'Crime'
];

export const FORMATS = ['All Formats', '2D', '3D', 'IMAX 2D', '4DX', 'Dolby Cinema'];

export const CINEMAS = [
  {
    id: 'apex_grand',
    name: 'Apex Grand Cinemas • Screen 2',
    venue: 'Sector 4 CinePark • Hall A',
    distance: '2.4 km',
    amenities: ['Dolby Atmos', '4K Laser', 'Recliner Luxury', 'Café Lounge'],
    cancellation: true,
    showtimes: [
      { id: 'st1', time: '10:30 AM', status: 'available', format: 'Dolby Atmos', screen: 'Screen 2' },
      { id: 'st2', time: '01:45 PM', status: 'filling_fast', format: 'Dolby Atmos', screen: 'Screen 2' },
      { id: 'st3', time: '05:15 PM', status: 'popular', format: 'Dolby Atmos', screen: 'Screen 2' },
      { id: 'st4', time: '08:45 PM', status: 'available', format: 'Dolby Atmos', screen: 'Screen 2' },
      { id: 'st5', time: '11:15 PM', status: 'almost_full', format: 'Dolby Atmos', screen: 'Screen 2' },
    ]
  },
  {
    id: 'cineluxe_imax',
    name: 'CineLuxe IMAX 3D • Arena Hall 4',
    venue: 'Metropolis Mall • 3rd Floor',
    distance: '4.1 km',
    amenities: ['IMAX 1.43:1', 'Laser 3D', 'Stadium Seating'],
    cancellation: true,
    showtimes: [
      { id: 'st6', time: '11:00 AM', status: 'available', format: 'IMAX 2D', screen: 'IMAX Hall 4' },
      { id: 'st7', time: '02:30 PM', status: 'available', format: 'IMAX 2D', screen: 'IMAX Hall 4' },
      { id: 'st8', time: '06:00 PM', status: 'filling_fast', format: 'IMAX 2D', screen: 'IMAX Hall 4' },
      { id: 'st9', time: '09:30 PM', status: 'available', format: 'IMAX 2D', screen: 'IMAX Hall 4' },
    ]
  },
  {
    id: 'starlight_4dx',
    name: 'Starlight Multiplex • 4DX Motion',
    venue: 'Central Promenade • Pavilion 7',
    distance: '5.8 km',
    amenities: ['4DX Motion Seats', 'Environmental Effects', 'Dolby 7.1'],
    cancellation: false,
    showtimes: [
      { id: 'st10', time: '12:15 PM', status: 'available', format: '4DX', screen: '4DX Pavilion' },
      { id: 'st11', time: '03:45 PM', status: 'available', format: '4DX', screen: '4DX Pavilion' },
      { id: 'st12', time: '07:15 PM', status: 'popular', format: '4DX', screen: '4DX Pavilion' },
      { id: 'st13', time: '10:30 PM', status: 'available', format: '4DX', screen: '4DX Pavilion' },
    ]
  }
];

export const SEAT_TIERS = {
  VIP: {
    name: 'VIP Recliner',
    code: 'VIP',
    price: 500,
    rows: ['A', 'B'],
    seatsPerRow: 8,
    color: '#8b5cf6',
    desc: 'Spacious electric recliners with private table & gourmet service'
  },
  PREMIUM: {
    name: 'Premium',
    code: 'PRIME',
    price: 350,
    rows: ['C', 'D', 'E', 'F'],
    seatsPerRow: 12,
    color: '#6366f1',
    desc: 'Ergonomic plush seats with prime viewing angles'
  },
  STANDARD: {
    name: 'Standard',
    code: 'CLASSIC',
    price: 250,
    rows: ['G', 'H', 'J', 'K'],
    seatsPerRow: 12,
    color: '#3b82f6',
    desc: 'Comfortable stadium seats with crystal clear Dolby acoustics'
  }
};

export const INITIAL_BOOKINGS = [
  {
    bookingId: 'FS-8849-2026',
    movie: MOVIES[0],
    cinema: 'Apex Grand Cinemas • Screen 2',
    date: 'Saturday, 25 Oct 2026',
    time: '05:15 PM',
    format: 'Dolby Atmos',
    seats: ['F7', 'F8'],
    tier: 'Premium',
    totalAmount: 756,
    status: 'CONFIRMED',
    bookingDate: '24 Oct 2026, 02:40 PM',
    isUpcoming: true,
  },
  {
    bookingId: 'FS-7102-2026',
    movie: MOVIES[2],
    cinema: 'CineLuxe IMAX 3D • Arena Hall 4',
    date: 'Sunday, 19 Oct 2026',
    time: '08:30 PM',
    format: 'IMAX 2D',
    seats: ['D4', 'D5'],
    tier: 'Premium',
    totalAmount: 756,
    status: 'COMPLETED',
    bookingDate: '18 Oct 2026, 11:15 AM',
    isUpcoming: false,
  }
];

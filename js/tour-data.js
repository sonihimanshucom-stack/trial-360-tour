// Tour content. Angles are in degrees: yaw 0 = centre of the panorama,
// positive = to the right; pitch positive = up.
// To place a hotspot, open the tour with #debug and click: the console logs yaw/pitch.

export const TOUR = {
  property: "Radisson Blu",
  title: "Udaipur Palace Resort & Spa",
  tagline: "A virtual journey through the palace",
  enquireUrl: "https://www.radissonhotels.com/",
  startScene: "arrival",
  guidedSeconds: 11,
  // schematic resort map, coordinates in % of the map box
  map: true,
};

export const SCENES = [
  {
    id: "arrival",
    title: "The Arrival Court",
    subtitle: "Elephant fountain & domed porte-cochère",
    description:
      "The welcome begins here: a carved sandstone elephant fountain ringed with marigolds, framed by the white domes and scalloped arches of the palace porte-cochère.",
    yaw: 20,
    map: { x: 54, y: 86 },
    hotspots: [
      { type: "scene", to: "driveway", yaw: -31, pitch: -4, label: "Palace Drive", arrive: 15 },
      { type: "scene", to: "lawn", yaw: -122, pitch: -6, label: "The Grand Lawn", arrive: 0 },
      {
        type: "info", yaw: 79, pitch: 12, title: "The Elephant Fountain",
        text: "Sculpted elephants in red sandstone — a symbol of royal welcome in Mewar — rise from a reflecting pool planted with seasonal blooms.",
      },
      {
        type: "info", yaw: 110, pitch: 6, title: "Porte-cochère",
        text: "Chhatri-style domes and cusped arches in white echo the lake palaces of Udaipur, setting the tone for the resort within.",
      },
    ],
  },
  {
    id: "driveway",
    title: "Palace Drive",
    subtitle: "A cobbled avenue through the gardens",
    description:
      "Hand-laid stone setts curve between date palms and flowering hedges, with the palace wing rising beyond the garden walls.",
    yaw: 15,
    map: { x: 46, y: 62, label: "left" },
    hotspots: [
      { type: "scene", to: "courtyard", yaw: 44, pitch: -14, label: "Jharokha Courtyard", arrive: -40 },
      { type: "scene", to: "lawn", yaw: 105, pitch: -4, label: "The Grand Lawn", arrive: 0 },
      { type: "scene", to: "arrival", yaw: -128, pitch: -5, label: "Arrival Court", arrive: 20 },
      {
        type: "info", yaw: 30, pitch: 14, title: "The Palace Wing",
        text: "Crowned with a parade of chhatris, the guest wing overlooks landscaped gardens and the resort's event lawns.",
      },
    ],
  },
  {
    id: "lawn",
    title: "The Grand Lawn",
    subtitle: "Open-air celebrations beneath the Aravalli sky",
    description:
      "A sweeping manicured lawn bordered by mature trees and garden pavilions — a natural stage for weddings, sangeet evenings and grand receptions.",
    yaw: 0,
    map: { x: 76, y: 50, label: "left" },
    hotspots: [
      { type: "scene", to: "driveway", yaw: 139, pitch: -3, label: "Palace Drive", arrive: -20 },
      { type: "scene", to: "arrival", yaw: 172, pitch: -2, label: "Arrival Court", arrive: 20 },
      {
        type: "info", yaw: -39, pitch: 5, title: "Garden Pavilion",
        text: "A vine-draped cupola anchors the lawn — an intimate setting for vows, photographs or a mehendi afternoon.",
      },
    ],
  },
  {
    id: "courtyard",
    title: "Jharokha Courtyard",
    subtitle: "Lotus fountain beneath carved balconies",
    description:
      "An enclosed Rajput courtyard of checkerboard marble, sculpted topiary and a lotus-tiled water channel, overlooked by projecting sandstone jharokhas.",
    yaw: -50,
    map: { x: 28, y: 36 },
    hotspots: [
      { type: "scene", to: "ballroom", yaw: -104, pitch: -6, label: "The Ballroom", arrive: 0 },
      { type: "scene", to: "driveway", yaw: 72, pitch: -4, label: "Palace Drive", arrive: 30 },
      {
        type: "info", yaw: -105, pitch: 22, title: "Jharokha Balconies",
        text: "Projecting latticed balconies, once used by royal households to watch the courtyard unseen, line the façade above the ballroom doors.",
      },
      {
        type: "info", yaw: 10, pitch: -40, title: "The Lotus Channel",
        text: "Inlaid lotus motifs float in a channel of cobalt mosaic — a contemporary take on the Mughal-Rajput water garden.",
      },
    ],
  },
  {
    id: "ballroom",
    title: "The Ballroom",
    subtitle: "Pillarless banquet hall with crystal chandeliers",
    description:
      "A column-free hall under a sculpted geometric ceiling and twin crystal chandeliers, with jaali-inspired wall art and flexible partitions for banquets of every scale.",
    yaw: 0,
    map: { x: 18, y: 16 },
    hotspots: [
      { type: "scene", to: "courtyard", yaw: 75, pitch: -2, label: "Jharokha Courtyard", arrive: 60 },
      {
        type: "info", yaw: -30, pitch: 40, title: "Crystal Chandeliers",
        text: "Twin cascading chandeliers hang from a coffered ceiling carved with interlocking geometric patterns.",
      },
      {
        type: "info", yaw: -68, pitch: 8, title: "Jaali Wall Art",
        text: "Niches shaped like palace arches and finials frame hand-painted panels — a modern reinterpretation of Rajasthani jaali screens.",
      },
    ],
  },
];

// oxlint-disable node/no-process-env, no-console
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import {
  loadBlockCommitments,
  occupyVenue,
  overlapsLedger,
  suspendBlockCommitments,
  vacateVenue,
} from "#/features/venue-requests/occupancy.server";
import { lockVenue } from "#/features/venue-requests/venue-lock.server";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { liftBlockRows, recordBlockRows } from "#/features/venues/blocks.server";

export type SeedUser = typeof schema.user.$inferInsert;

export const seedUsers: SeedUser[] = [
  {
    id: "test-user-1",
    name: "John Doe",
    email: "john.doe@example.com",
    emailVerified: true,
    role: "attendee",
  },
  {
    id: "test-user-2",
    name: "Jane Doe",
    email: "jane.doe@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
  {
    id: "user-demo-1",
    name: "Demo User",
    email: "demo@example.com",
    emailVerified: true,
    role: "attendee",
  },
];

/**
 * One hundred extra people for local browsing, search, and dashboards. The same index always
 * builds the same person, and the trailing index keeps every email unique.
 *
 * Use only the two self-assignable roles. More internal roles would take new submissions from
 * the seeded Coordinator, and the e2e suite expects only that Coordinator.
 */
const EXTRA_FIRST_NAMES = [
  "Amara",
  "Priya",
  "Kenji",
  "Sofia",
  "Mateo",
  "Aisha",
  "Liam",
  "Zhao",
  "Fatima",
  "Diego",
  "Ingrid",
  "Kwame",
  "Yuki",
  "Elena",
  "Omar",
  "Naledi",
  "Ravi",
  "Clara",
  "Tomas",
  "Mei",
  "Jonas",
  "Zara",
  "Felix",
  "Anika",
  "Samir",
  "Lucia",
  "Wei",
  "Nia",
  "Pablo",
  "Hana",
];

const EXTRA_LAST_NAMES = [
  "Okafor",
  "Sharma",
  "Tanaka",
  "Rossi",
  "Garcia",
  "Khan",
  "Obrien",
  "Wei",
  "Hassan",
  "Silva",
  "Larsen",
  "Mensah",
  "Sato",
  "Petrova",
  "Haddad",
  "Dube",
  "Patel",
  "Muller",
  "Novak",
  "Chen",
  "Berg",
  "Ali",
  "Weber",
  "Nair",
  "Costa",
  "Lim",
  "Adeyemi",
  "Krishnan",
  "Santos",
  "Kim",
];

function slugPart(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z]+/g, "");
  return slug === "" ? "seed" : slug;
}

export const seedExtraUsers: SeedUser[] = Array.from({ length: 100 }, (_, i) => {
  const first = EXTRA_FIRST_NAMES[i % EXTRA_FIRST_NAMES.length];
  const last = EXTRA_LAST_NAMES[(i * 7 + 3) % EXTRA_LAST_NAMES.length];
  const n = i + 4;
  return {
    id: `seed-user-${String(n).padStart(3, "0")}`,
    name: `${first} ${last}`,
    email: `${slugPart(first)}.${slugPart(last)}.${n}@example.com`,
    emailVerified: true,
    role: i % 2 === 0 ? "attendee" : "event_organiser",
  };
});

/**
 * Use this password for every seeded account: staff, the demo organiser, and the demo attendee (PTR-59).
 * This password is for development only. Do not put personal data here. The password meets
 * PasswordSchema: 8–128 characters, including a digit and a symbol.
 */
export const SEED_STAFF_PASSWORD = "password1!";

/** The seed records and lifts its venue blocks as this Venue Staff account. */
const SEED_VENUE_STAFF_ID = "seed-venue-staff-1";

/**
 * Create internal staff accounts for the seed (PTR-59). Sign-up permits only external roles
 * (PTR-5), so insert these accounts directly and bypass the sign-up validator.
 */
export const seedStaffUsers: SeedUser[] = [
  {
    id: "seed-coordinator-1",
    name: "Seeded Event Coordinator",
    email: "coordinator.seed@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  {
    id: SEED_VENUE_STAFF_ID,
    name: "Seeded Venue Staff",
    email: "venue.staff.seed@example.com",
    emailVerified: true,
    role: "venue_staff",
  },
  {
    id: "seed-tech-support-1",
    name: "Seeded Technical Support",
    email: "tech.support.seed@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
];

export type SeedVenue = Omit<typeof schema.venues.$inferInsert, "id">;

/**
 * Create demo venues for PTR-59 criterion 3 with the PTR-26 schema. The unique `venues.name`
 * field is the idempotency key, so a re-run does not add duplicate venues. `operatingHours` uses
 * weekday wall-clock times in `HH:MM` format. Use `null` for a closed day.
 */
const baseVenues: SeedVenue[] = [
  {
    name: "Harbour Hall",
    location: "Level 1, ConnectSphere Marina Centre",
    maxCapacity: 300,
    facilities: ["Stage", "Projector", "PA system", "Wi-Fi", "Catering prep area"],
    accessibilityFeatures: ["Step-free access", "Accessible toilets", "Hearing loop"],
    supportedLayouts: ["theatre", "banquet", "exhibition"],
    operatingHours: {
      mon: { opens: "08:00", closes: "22:00" },
      tue: { opens: "08:00", closes: "22:00" },
      wed: { opens: "08:00", closes: "22:00" },
      thu: { opens: "08:00", closes: "22:00" },
      fri: { opens: "08:00", closes: "23:00" },
      sat: { opens: "09:00", closes: "23:00" },
      sun: null,
    },
  },
  {
    name: "Seminar Room 2A",
    location: "Level 2, ConnectSphere Marina Centre",
    maxCapacity: 40,
    facilities: ["Projector", "Whiteboard", "Video conferencing", "Wi-Fi"],
    accessibilityFeatures: ["Step-free access", "Adjustable-height desks"],
    supportedLayouts: ["classroom", "boardroom"],
    operatingHours: {
      mon: { opens: "09:00", closes: "18:00" },
      tue: { opens: "09:00", closes: "18:00" },
      wed: { opens: "09:00", closes: "18:00" },
      thu: { opens: "09:00", closes: "18:00" },
      fri: { opens: "09:00", closes: "18:00" },
      sat: null,
      sun: null,
    },
  },
  {
    name: "Rooftop Pavilion",
    location: "Level 12, ConnectSphere Tower",
    maxCapacity: 120,
    facilities: ["PA system", "Bar counter", "Wi-Fi"],
    accessibilityFeatures: ["Lift access"],
    supportedLayouts: ["banquet", "other"],
    operatingHours: {
      mon: null,
      tue: null,
      wed: { opens: "17:00", closes: "23:00" },
      thu: { opens: "17:00", closes: "23:00" },
      fri: { opens: "17:00", closes: "23:30" },
      sat: { opens: "11:00", closes: "23:30" },
      sun: { opens: "11:00", closes: "21:00" },
    },
  },
];

/** Forty-seven extra venue names. Names stay hand-written; the code derives the rest. */
const EXTRA_VENUE_NAMES = [
  "Willow Studio",
  "Meridian Loft",
  "Casuarina Room",
  "Orchid Ballroom",
  "Banyan Hall",
  "Saffron Suite",
  "Lotus Seminar Room",
  "Amber Auditorium",
  "Jade Conference Room",
  "Coral Deck",
  "Driftwood Pavilion",
  "Fern Courtyard",
  "Granite Forum",
  "Hibiscus Hall",
  "Ivory Boardroom",
  "Juniper Lodge",
  "Koi Garden Terrace",
  "Lantern Room",
  "Maple Learning Lab",
  "Nutmeg Theatre",
  "Onyx Black Box",
  "Palm Cove Room",
  "Quartz Studio",
  "Rattan Retreat",
  "Sandalwood Suite",
  "Teak Auditorium",
  "Umbra Gallery",
  "Vista Sky Lounge",
  "Wisteria Hall",
  "Cypress Chamber",
  "Dune Event Space",
  "Ember Workshop Room",
  "Fig Tree Courtyard",
  "Grove Meeting Pod",
  "Horizon Conference Suite",
  "Indigo Performance Hall",
  "Jasmine Function Room",
  "Kelp Marine Lab",
  "Lagoon View Deck",
  "Mangrove Hall",
  "Nimbus Rooftop",
  "Olive Branch Room",
  "Papaya Studio",
  "Reed Amphitheatre",
  "Seagrass Pavilion",
  "Tamarind Ballroom",
  "Ursa Community Hall",
];

const EXTRA_VENUE_BUILDINGS = [
  "Marina Centre",
  "Tower",
  "Garden Wing",
  "Harbourfront Block",
  "Orchard Annex",
  "Riverside Pavilion",
];

const EXTRA_VENUE_CAPACITIES = [
  80, 120, 180, 250, 90, 150, 300, 110, 200, 400, 130, 220, 500, 95, 160,
];

const EXTRA_VENUE_FACILITIES: string[][] = [
  ["Stage", "PA system", "Wi-Fi", "Projector"],
  ["Whiteboard", "Video conferencing", "Wi-Fi", "Projector"],
  ["PA system", "Bar counter", "Wi-Fi", "Dance floor"],
  ["Projector", "Whiteboard", "Wi-Fi", "Air conditioning"],
  ["Stage", "Lighting rig", "PA system", "Wi-Fi", "Backstage room"],
  ["Video conferencing", "Whiteboard", "Wi-Fi", "Coffee station"],
];

const EXTRA_VENUE_ACCESSIBILITY: string[][] = [
  ["Step-free access", "Accessible toilets", "Hearing loop"],
  ["Step-free access", "Lift access"],
  ["Lift access", "Accessible toilets"],
  ["Step-free access", "Adjustable-height desks", "Hearing loop"],
  ["Step-free access", "Accessible toilets", "Braille signage"],
];

const EXTRA_VENUE_LAYOUTS: SeedVenue["supportedLayouts"][] = [
  ["theatre", "classroom"],
  ["banquet", "exhibition"],
  ["boardroom", "classroom"],
  ["theatre", "banquet", "exhibition"],
  ["other"],
  ["classroom", "boardroom", "other"],
];

const EXTRA_VENUE_HOURS: SeedVenue["operatingHours"][] = [
  {
    mon: { opens: "08:00", closes: "22:00" },
    tue: { opens: "08:00", closes: "22:00" },
    wed: { opens: "08:00", closes: "22:00" },
    thu: { opens: "08:00", closes: "22:00" },
    fri: { opens: "08:00", closes: "22:00" },
    sat: { opens: "09:00", closes: "18:00" },
    sun: null,
  },
  {
    mon: { opens: "08:00", closes: "22:00" },
    tue: { opens: "08:00", closes: "22:00" },
    wed: { opens: "08:00", closes: "22:00" },
    thu: { opens: "08:00", closes: "22:00" },
    fri: { opens: "08:00", closes: "22:00" },
    sat: { opens: "09:00", closes: "22:00" },
    sun: { opens: "10:00", closes: "18:00" },
  },
  {
    mon: null,
    tue: null,
    wed: { opens: "17:00", closes: "23:00" },
    thu: { opens: "17:00", closes: "23:00" },
    fri: { opens: "17:00", closes: "23:30" },
    sat: { opens: "11:00", closes: "23:30" },
    sun: { opens: "11:00", closes: "21:00" },
  },
  {
    mon: { opens: "09:00", closes: "18:00" },
    tue: { opens: "09:00", closes: "18:00" },
    wed: { opens: "09:00", closes: "18:00" },
    thu: { opens: "09:00", closes: "18:00" },
    fri: { opens: "09:00", closes: "18:00" },
    sat: null,
    sun: null,
  },
];

const seedExtraVenues: SeedVenue[] = EXTRA_VENUE_NAMES.map((name, i) => ({
  name,
  location: `Level ${(i % 12) + 1}, ConnectSphere ${EXTRA_VENUE_BUILDINGS[i % EXTRA_VENUE_BUILDINGS.length]}`,
  maxCapacity: EXTRA_VENUE_CAPACITIES[i % EXTRA_VENUE_CAPACITIES.length],
  facilities: EXTRA_VENUE_FACILITIES[i % EXTRA_VENUE_FACILITIES.length],
  accessibilityFeatures: EXTRA_VENUE_ACCESSIBILITY[i % EXTRA_VENUE_ACCESSIBILITY.length],
  supportedLayouts: EXTRA_VENUE_LAYOUTS[i % EXTRA_VENUE_LAYOUTS.length],
  operatingHours: EXTRA_VENUE_HOURS[i % EXTRA_VENUE_HOURS.length],
}));

export const seedVenues: SeedVenue[] = [...baseVenues, ...seedExtraVenues];

/**
 * Add two future unavailable periods for PTR-59 criterion 4. The PTR-28 availability calendar
 * can then show unavailable periods as well as bookings. Use venue names as keys because the
 * database assigns venue ids. Calculate dates from seed time so they stay in the future on every
 * run. Store timestamps as `YYYY-MM-DD HH:MM:SS`, the column's `mode: "string"` format. On each
 * run, `runSeed` replaces the seed's `(venue, reason)` rows. Moving dates do not match the unique
 * period index, so that index cannot make the seed repeatable.
 */
function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function futureDay(days: number, time = "00:00:00"): string {
  return `${futureDate(days)} ${time}`;
}

/**
 * Harbour Hall closes on Sunday and has resurfacing blocks from futureDay(30) to futureDay(34).
 * Keep the demo request on a free Monday-to-Saturday slot. If the date is Sunday, move it to
 * Monday. Use a UTC weekday so the returned string matches the calendar day from `futureDate`.
 */
function futureWeekdayDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Seminar Room 2A is closed on weekends. Move the attendee demo date to Monday if it falls on
 * Saturday or Sunday. Harbour Hall opens on Saturdays, so use `futureWeekdayDate` for that venue.
 */
function futureOpenDayDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

export const seedVenueUnavailability: {
  venueName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}[] = [
  {
    venueName: "Harbour Hall",
    startsAt: futureDay(30),
    endsAt: futureDay(34, "23:59:59"),
    reason: "Annual floor resurfacing",
  },
  {
    venueName: "Seminar Room 2A",
    startsAt: futureDay(45, "09:00:00"),
    endsAt: futureDay(45, "18:00:00"),
    reason: "Internal staff training",
  },
  {
    venueName: "Willow Studio",
    startsAt: futureDay(50, "09:00:00"),
    endsAt: futureDay(51, "18:00:00"),
    reason: "Acoustic panel upgrade",
  },
  {
    venueName: "Orchid Ballroom",
    startsAt: futureDay(60),
    endsAt: futureDay(62, "23:59:59"),
    reason: "Chandelier maintenance",
  },
  {
    venueName: "Nimbus Rooftop",
    startsAt: futureDay(70, "17:00:00"),
    endsAt: futureDay(70, "23:00:00"),
    reason: "Private hire blackout",
  },
];

/**
 * Small fictional catalogue for the equipment availability stories. The unique
 * `equipment_types.name` field is the idempotency key.
 */
export const seedEquipmentTypes: Omit<typeof schema.equipmentTypes.$inferInsert, "id">[] = [
  { name: "Portable Projector", quantityHeld: 8 },
  { name: "Wireless Microphone", quantityHeld: 12 },
  { name: "Portable PA System", quantityHeld: 4 },
  { name: "Folding Chair", quantityHeld: 200 },
  { name: "Round Banquet Table", quantityHeld: 40 },
  { name: "LED Uplighter", quantityHeld: 24 },
  { name: "Portable Stage Deck", quantityHeld: 12 },
  { name: "Lectern", quantityHeld: 6 },
  { name: "Whiteboard Easel", quantityHeld: 10 },
  { name: "Extension Lead Reel", quantityHeld: 15 },
];

/**
 * Add a fictional out-of-service quantity. The equipment type still has held units, and the seed
 * does not represent a real asset.
 */
export const seedEquipmentUnavailability: {
  equipmentTypeName: string;
  quantityUnavailable: number;
  reason: string;
}[] = [
  {
    equipmentTypeName: "Portable Projector",
    quantityUnavailable: 1,
    reason: "Demo unit under maintenance",
  },
  {
    equipmentTypeName: "Wireless Microphone",
    quantityUnavailable: 2,
    reason: "Two units sent for repair",
  },
  {
    equipmentTypeName: "LED Uplighter",
    quantityUnavailable: 2,
    reason: "Firmware upgrade batch",
  },
];
/**
 * PTR-8: seed the demo event as a submitted event request. The event record does not exist until
 * PTR-21/24, and access checks use `event_requests`. Use the name and organiser as the idempotency
 * key. Look up the row before insert because `id` is serial; a fixed id could conflict with the
 * next application insert.
 */
export const DEMO_EVENT_NAME = "ConnectSphere Demo Summit";
const DEMO_EVENT_ORGANISER_ID = "test-user-2";
const DEMO_EVENT_COORDINATOR_ID = "seed-coordinator-1";

/**
 * PTR-44: seed a confirmed event with registration enabled for the attendee demo. New attendees
 * can see it because browsing requires `confirmed` and `registrationEnabled`; it does not check
 * the registration window. Keep this event separate from the submitted, planning-stage demo used
 * for venue search and equipment requests. Find it by organiser and name before each insert. On
 * every run, update the required `confirmed` attribution and future dates.
 */
export const ATTENDEE_DEMO_EVENT_NAME = "ConnectSphere Open Day";
export const ATTENDEE_DEMO_VENUE_NAME = "Seminar Room 2A";

/**
 * Twenty extra events for browsing, dashboards, and search. The first sixteen are confirmed
 * with registration on; the last four stay submitted. Each event uses a different organiser
 * from `seedExtraUsers` and a different venue on its own date, so approved bookings never
 * share a venue and a date. Find each event by `(organiserId, eventName)`, like the demos.
 */
export const seedExtraEvents: {
  name: string;
  type: string;
  purpose: string;
  description: string;
  venueName: string;
  dayOffset: number;
  attendance: number;
  status: "confirmed" | "submitted";
}[] = [
  {
    name: "Harbour Food Festival",
    type: "Festival",
    purpose: "Celebrate hawker heritage with tastings and chef demos.",
    description: "Two dozen stalls, live cooking stations and a night market finale by the water.",
    venueName: "Willow Studio",
    dayOffset: 35,
    attendance: 60,
    status: "confirmed",
  },
  {
    name: "Marina Tech Expo",
    type: "Expo",
    purpose: "Showcase local startups and student robotics teams.",
    description: "Demo booths, lightning talks and a hands-on gadget lab for all ages.",
    venueName: "Meridian Loft",
    dayOffset: 39,
    attendance: 55,
    status: "confirmed",
  },
  {
    name: "Community Health Fair",
    type: "Health Fair",
    purpose: "Free screenings and wellness coaching for residents.",
    description: "Blood-pressure checks, nutrition counselling and family fitness tasters.",
    venueName: "Onyx Black Box",
    dayOffset: 43,
    attendance: 45,
    status: "confirmed",
  },
  {
    name: "Youth Climate Summit",
    type: "Summit",
    purpose: "Give students a stage for neighbourhood green plans.",
    description: "Keynotes, project showcases and a pledge wall for school teams.",
    venueName: "Orchid Ballroom",
    dayOffset: 47,
    attendance: 70,
    status: "confirmed",
  },
  {
    name: "Artisan Makers Market",
    type: "Market",
    purpose: "Support independent craft sellers and printmakers.",
    description: "Forty stalls, live letterpress demos and a gift-wrapping corner.",
    venueName: "Banyan Hall",
    dayOffset: 51,
    attendance: 50,
    status: "confirmed",
  },
  {
    name: "Startup Pitch Night",
    type: "Networking",
    purpose: "Connect early founders with mentors and operators.",
    description: "Eight five-minute pitches, open Q&A and mentor speed-dating.",
    venueName: "Saffron Suite",
    dayOffset: 55,
    attendance: 40,
    status: "confirmed",
  },
  {
    name: "Multilingual Storytelling Morning",
    type: "Family",
    purpose: "Stories in four languages for preschoolers and parents.",
    description: "Librarians rotate English, Mandarin, Malay and Tamil sessions with songs.",
    venueName: "Palm Cove Room",
    dayOffset: 59,
    attendance: 30,
    status: "confirmed",
  },
  {
    name: "Senior Wellness Workshop",
    type: "Workshop",
    purpose: "Gentle exercise and fall-prevention coaching for seniors.",
    description: "Physio-led movement, balance screening and a social tea break.",
    venueName: "Amber Auditorium",
    dayOffset: 63,
    attendance: 35,
    status: "confirmed",
  },
  {
    name: "Interfaith Harmony Dinner",
    type: "Dinner",
    purpose: "Bring faith groups together over a shared table.",
    description: "Family-style courses, youth choir interludes and guided table conversations.",
    venueName: "Jade Conference Room",
    dayOffset: 67,
    attendance: 65,
    status: "confirmed",
  },
  {
    name: "Urban Gardening Bootcamp",
    type: "Workshop",
    purpose: "Teach corridor and rooftop growing basics.",
    description: "Seed starting, composting and a take-home planter for every attendee.",
    venueName: "Coral Deck",
    dayOffset: 71,
    attendance: 28,
    status: "confirmed",
  },
  {
    name: "Robotics Discovery Day",
    type: "Open Day",
    purpose: "Let children drive robots and meet student builders.",
    description: "Obstacle courses, coding corners and a mini sumo tournament.",
    venueName: "Rattan Retreat",
    dayOffset: 75,
    attendance: 55,
    status: "confirmed",
  },
  {
    name: "Heritage Walks Festival",
    type: "Festival",
    purpose: "Guided walks through the district's trading past.",
    description: "Docent-led routes, photo exhibition and a closing talk at the gallery.",
    venueName: "Fern Courtyard",
    dayOffset: 79,
    attendance: 42,
    status: "confirmed",
  },
  {
    name: "Women in Engineering Panel",
    type: "Panel",
    purpose: "Spotlight practitioners across civil, software and marine fields.",
    description: "Panel, breakout mentoring and a student poster wall.",
    venueName: "Granite Forum",
    dayOffset: 83,
    attendance: 48,
    status: "confirmed",
  },
  {
    name: "Night Market Cinema",
    type: "Screening",
    purpose: "Outdoor shorts and local documentaries under the stars.",
    description: "Bean-bag seating, food trucks and filmmaker Q&As between blocks.",
    venueName: "Hibiscus Hall",
    dayOffset: 87,
    attendance: 68,
    status: "confirmed",
  },
  {
    name: "Inclusive Sports Carnival",
    type: "Sports",
    purpose: "Try wheelchair basketball, goalball and boccia.",
    description: "Coached stations, friendly matches and a medal ceremony.",
    venueName: "Sandalwood Suite",
    dayOffset: 91,
    attendance: 52,
    status: "confirmed",
  },
  {
    name: "Early Childhood Educators Forum",
    type: "Conference",
    purpose: "Share play-based learning practices across centres.",
    description: "Case studies, classroom provocations and a resource swap table.",
    venueName: "Juniper Lodge",
    dayOffset: 95,
    attendance: 38,
    status: "confirmed",
  },
  {
    name: "Hawker Culture Showcase",
    type: "Showcase",
    purpose: "Record recipes and stories from second-generation hawkers.",
    description: "Live interviews, tastings and a printed zine for every guest.",
    venueName: "Koi Garden Terrace",
    dayOffset: 99,
    attendance: 44,
    status: "submitted",
  },
  {
    name: "Digital Safety for Families",
    type: "Workshop",
    purpose: "Practical scam-spotting and device hygiene for parents.",
    description: "Live scam demos, password-manager setup and a take-home checklist.",
    venueName: "Lantern Room",
    dayOffset: 103,
    attendance: 32,
    status: "submitted",
  },
  {
    name: "Choir and Orchestra Gala",
    type: "Concert",
    purpose: "Annual joint performance with community soloists.",
    description: "Two halves, sing-along finale and a reception in the foyer.",
    venueName: "Teak Auditorium",
    dayOffset: 107,
    attendance: 62,
    status: "submitted",
  },
  {
    name: "Neighbourhood Volunteer Awards",
    type: "Awards",
    purpose: "Honour block champions and ground-up groups.",
    description: "Nominee films, award presentation and a dessert reception.",
    venueName: "Nutmeg Theatre",
    dayOffset: 111,
    attendance: 58,
    status: "submitted",
  },
];

const EXTRA_EQUIPMENT_ITEMS = [
  "Portable Projector",
  "Wireless Microphone",
  "Portable PA System",
  "Folding Chair",
  "LED Uplighter",
];

/**
 * Every seed takes this fixed key before it looks up the demo request. A lookup then insert is not
 * safe by itself: `select ... for update` takes no lock when it finds no row, so concurrent seeds
 * can both insert. The advisory lock serializes those seeds.
 */
const DEMO_EVENT_SEED_LOCK_KEY = 970_097;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

type SeedTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The app writers take the Bun SQL transaction. The node-postgres one has the same methods. */
function asVenueTx(tx: SeedTx): VenueTx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same drizzle methods, other driver
  return tx as unknown as VenueTx;
}

/**
 * Keep a seeded venue request's `venue_occupancy` rows in step with its status, as the app writers
 * do: delete the request's rows, then write one for an approved booking, with the venue's current
 * buffers. Under a live block, move the block's ledger row aside, write the booking row, suspend
 * it as the block recorder does, and write the block row again. A conflict between two
 * commitments stops the seed.
 */
async function syncSeedOccupancy(
  tx: SeedTx,
  request: {
    id: string;
    eventId: number;
    venueId: number;
    startsAt: string;
    endsAt: string;
    status: "pending" | "approved";
  }
): Promise<void> {
  const venueTx = asVenueTx(tx);
  await vacateVenue(venueTx, { venueRequestId: request.id });
  if (request.status !== "approved") return;
  await lockVenue(venueTx, request.venueId);
  const [venue] = await tx
    .select({
      setupMinutes: schema.venues.setupMinutes,
      turnaroundMinutes: schema.venues.turnaroundMinutes,
    })
    .from(schema.venues)
    .where(eq(schema.venues.id, request.venueId));
  const occupancy = {
    venueId: request.venueId,
    eventId: request.eventId,
    startsAt: request.startsAt,
    endsAt: request.endsAt,
    setupMinutes: venue.setupMinutes,
    turnaroundMinutes: venue.turnaroundMinutes,
  };
  const blocks = await tx
    .select({
      id: schema.venueUnavailability.id,
      startsAt: schema.venueOccupancy.startsAt,
      endsAt: schema.venueOccupancy.endsAt,
    })
    .from(schema.venueOccupancy)
    .innerJoin(
      schema.venueUnavailability,
      eq(schema.venueUnavailability.id, schema.venueOccupancy.venueUnavailabilityId)
    )
    .where(overlapsLedger(occupancy))
    .orderBy(asc(schema.venueOccupancy.startsAt));
  if (blocks.length > 0) {
    await tx.delete(schema.venueOccupancy).where(
      inArray(
        schema.venueOccupancy.venueUnavailabilityId,
        blocks.map(block => block.id)
      )
    );
  }
  await occupyVenue(venueTx, { ...occupancy, venueRequestId: request.id });
  for (const block of blocks) {
    const extent = { venueId: request.venueId, startsAt: block.startsAt, endsAt: block.endsAt };
    // oxlint-disable-next-line eslint/no-await-in-loop -- suspend under one block at a time
    const covered = await loadBlockCommitments(venueTx, extent);
    // oxlint-disable-next-line eslint/no-await-in-loop -- suspend under one block at a time
    await suspendBlockCommitments(venueTx, extent, covered);
    // oxlint-disable-next-line eslint/no-await-in-loop -- suspend under one block at a time
    await occupyVenue(venueTx, {
      ...extent,
      eventId: null,
      venueUnavailabilityId: block.id,
      setupMinutes: 0,
      turnaroundMinutes: 0,
    });
  }
}

/**
 * Insert seed users and staff credentials. Repeated runs do not add duplicates.
 */
export async function runSeed(database: Database): Promise<void> {
  await database.insert(schema.user).values(seedUsers).onConflictDoNothing();
  await database.insert(schema.user).values(seedExtraUsers).onConflictDoNothing();
  await database.insert(schema.user).values(seedStaffUsers).onConflictDoNothing();

  // Seed accounts share one password, so they can share one scrypt hash. `onConflictDoNothing`
  // keeps repeated runs free of duplicate rows.
  const seedPasswordHash = await hashPassword(SEED_STAFF_PASSWORD);
  await database
    .insert(schema.account)
    .values(
      [...seedStaffUsers, ...seedUsers, ...seedExtraUsers].map(user => ({
        id: `seed-account-${user.id}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: seedPasswordHash,
      }))
    )
    .onConflictDoNothing();

  await database.insert(schema.venues).values(seedVenues).onConflictDoNothing();
  await database.insert(schema.equipmentTypes).values(seedEquipmentTypes).onConflictDoNothing();

  const equipmentTypeRows = await database
    .select({ id: schema.equipmentTypes.id, name: schema.equipmentTypes.name })
    .from(schema.equipmentTypes)
    .where(
      inArray(
        schema.equipmentTypes.name,
        seedEquipmentTypes.map(type => type.name)
      )
    );
  const equipmentTypeIdByName = new Map(equipmentTypeRows.map(type => [type.name, type.id]));

  await database
    .insert(schema.equipmentUnavailability)
    .values(
      seedEquipmentUnavailability.map(record => {
        const equipmentTypeId = equipmentTypeIdByName.get(record.equipmentTypeName);
        if (equipmentTypeId === undefined) {
          throw new Error(`Seed equipment type "${record.equipmentTypeName}" was not inserted`);
        }
        return {
          equipmentTypeId,
          quantityUnavailable: record.quantityUnavailable,
          reason: record.reason,
        };
      })
    )
    .onConflictDoNothing();

  const venueRows = await database
    .select({ id: schema.venues.id, name: schema.venues.name })
    .from(schema.venues)
    .where(
      inArray(
        schema.venues.name,
        seedVenues.map(venue => venue.name)
      )
    );
  const venueIdByName = new Map(venueRows.map(row => [row.name, row.id]));

  const seedBlocks = seedVenueUnavailability.map(({ venueName, ...period }) => {
    const venueId = venueIdByName.get(venueName);
    if (venueId === undefined) {
      throw new Error(`Seed venue "${venueName}" was not inserted`);
    }
    return { venue: { id: venueId, name: venueName }, period };
  });

  // Dates use seed time, so a re-run lifts each live block that the seed wrote and records the
  // periods again, with the app's ledger writes and no notices. Use `(venue, reason)` and the seed
  // staff as the key, because moving dates do not match the unique period index. A block with no
  // creator is a seed block from before blocks recorded their creator.
  await database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_EVENT_SEED_LOCK_KEY})`);
    const venueTx = asVenueTx(tx);
    const venueIds = [...new Set(seedBlocks.map(({ venue }) => venue.id))].toSorted(
      (left, right) => left - right
    );
    for (const venueId of venueIds) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- lock the venues in ascending id order
      await lockVenue(venueTx, venueId);
    }

    const ownBlocks = await tx
      .select()
      .from(schema.venueUnavailability)
      .where(
        and(
          isNull(schema.venueUnavailability.liftedAt),
          or(
            isNull(schema.venueUnavailability.createdById),
            eq(schema.venueUnavailability.createdById, SEED_VENUE_STAFF_ID)
          ),
          or(
            ...seedBlocks.map(({ venue, period }) =>
              and(
                eq(schema.venueUnavailability.venueId, venue.id),
                eq(schema.venueUnavailability.reason, period.reason)
              )
            )
          )
        )
      )
      .orderBy(asc(schema.venueUnavailability.id))
      .for("update");
    for (const block of ownBlocks) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- lift the blocks one at a time
      await liftBlockRows(venueTx, block, SEED_VENUE_STAFF_ID);
    }

    for (const { venue, period } of seedBlocks) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- record the periods in catalogue order
        await recordBlockRows(venueTx, venue, period, SEED_VENUE_STAFF_ID);
      } catch (error) {
        // A live block from another writer wins over a seed period that overlaps it. The overlap
        // probe refuses before any write, so the transaction stays usable. Skip the period, so
        // `db:seed` stays safe to re-run.
        if (!(error instanceof ConflictError)) throw error;
        console.warn(`Skipped the seeded period "${period.reason}": ${error.message}`);
      }
    }
  });
  // Hold the advisory lock for the transaction so concurrent seeds do not race the lookup. Lock
  // the request row when it exists, so a concurrent delete waits until the seed writes its children.
  await database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_EVENT_SEED_LOCK_KEY})`);

    const existingDemoRequests = await tx
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(
        and(
          eq(schema.eventRequests.organiserId, DEMO_EVENT_ORGANISER_ID),
          eq(schema.eventRequests.eventName, DEMO_EVENT_NAME)
        )
      )
      .limit(1)
      .for("update");

    // Use seed time and update this window on every run. A database seeded more than a month ago
    // would keep a closed window. Compute the date once so a run across midnight uses one day for
    // both the start and end.
    const demoDate = futureWeekdayDate(20);
    const demoTiming = {
      proposedDates: [{ start: `${demoDate}T09:00`, end: `${demoDate}T17:00` }],
      registrationOpensAt: `${futureDate(-1)}T09:00`,
      registrationClosesAt: `${futureDate(19)}T17:00`,
    };
    // This text matches Harbour Hall's facilities and accessibility fields exactly. The prefilled
    // search therefore returns the PTR-29 AC5 demo result.
    const demoRequirements = {
      expectedAttendance: 120,
      venueRequirements: "Projector, PA system",
      roomLayoutPreference: "Theatre seating",
      accessibilityRequirements: "Step-free access and hearing loop",
    };

    let demoRequestId = existingDemoRequests.at(0)?.id;
    if (demoRequestId === undefined) {
      const [inserted] = await tx
        .insert(schema.eventRequests)
        .values({
          organiserId: DEMO_EVENT_ORGANISER_ID,
          status: "submitted",
          submittedAt: new Date(),
          assignedCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
          assignedAt: new Date(),
          eventName: DEMO_EVENT_NAME,
          purpose: "Exercise each role's event access locally.",
          ...demoTiming,
          ...demoRequirements,
          description: "A seeded event for exercising role-aware event access locally.",
          eventType: "Conference",
          equipmentRequirements: [{ type: "Projector", quantity: 1 }],
          specialArrangements: "",
          registrationEnabled: true,
          registrationCapacity: 150,
        })
        .returning({ id: schema.eventRequests.id });

      demoRequestId = inserted.id;
    } else {
      // Update the requirements too, so an old local database gets the current searchable demo
      // text. If an earlier seed left this event confirmed, restore `submitted`. That status has
      // no decision or confirmation attribution, as the CHECK constraints require.
      await tx
        .update(schema.eventRequests)
        .set({
          ...demoTiming,
          ...demoRequirements,
          status: "submitted",
          submittedAt: sql`coalesce(${schema.eventRequests.submittedAt}, now())`,
          decisionReason: null,
          decidedByCoordinatorId: null,
          decidedByCoordinatorName: null,
          decidedAt: null,
          confirmedById: null,
          confirmedByName: null,
          confirmedAt: null,
          completedById: null,
          completedByName: null,
          completedAt: null,
          cancelledById: null,
          cancelledByName: null,
          cancelledAt: null,
          equipmentSubmittedAt: null,
          equipmentArrangementsCompletedAt: null,
          equipmentArrangementsCompletedById: null,
        })
        .where(eq(schema.eventRequests.id, demoRequestId));
    }

    const demoVenueId = venueIdByName.get("Harbour Hall");
    if (demoVenueId === undefined) {
      throw new Error('Seed venue "Harbour Hall" was not inserted');
    }

    // Use the demo event's window for its Coordinator request. Both statements use this object, so
    // a window change updates both. `requestedById` is the demo Coordinator who AC5 allows to
    // withdraw the request.
    const demoVenueRequest = {
      venueId: demoVenueId,
      requestedById: DEMO_EVENT_COORDINATOR_ID,
      startsAt: `${demoDate} 09:00:00`,
      endsAt: `${demoDate} 17:00:00`,
    };

    // Update the window from `demoDate` and reset the status to `pending` on every run. This also
    // restores a row that someone withdrew in the UI. Keep `assignedStaffId` unchanged because
    // integration tests require the venue-staff fixture on this row.
    const existingDemoVenueRequests = await tx
      .select({ id: schema.venueRequests.id })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, "demo-venue-request-1"))
      .limit(1);

    if (existingDemoVenueRequests.length === 0) {
      await tx.insert(schema.venueRequests).values({
        id: "demo-venue-request-1",
        eventId: demoRequestId,
        ...demoVenueRequest,
        assignedStaffId: "seed-venue-staff-1",
      });
    } else {
      await tx
        .update(schema.venueRequests)
        .set({ ...demoVenueRequest, status: "pending" })
        .where(eq(schema.venueRequests.id, "demo-venue-request-1"));
    }
    // A pending request holds no venue time. This removes the row that an approval in the app wrote.
    await syncSeedOccupancy(tx, {
      id: "demo-venue-request-1",
      eventId: demoRequestId,
      venueId: demoVenueId,
      startsAt: demoVenueRequest.startsAt,
      endsAt: demoVenueRequest.endsAt,
      status: "pending",
    });

    // This is the booking shown on the attendee page (PTR-44 AC2). Use Seminar Room 2A, not
    // Harbour Hall, so it does not overlap the pending Harbour Hall request above or show the
    // PTR-36 conflict badge. No other approved booking uses this venue. Leave this booking
    // unassigned so the venue-staff dashboard shows one pending demo request. The approved booking
    // still appears on the venue-bookings page. `ON DELETE SET NULL` makes an unassigned booking a
    // valid state.
    const attendeeVenueId = venueIdByName.get(ATTENDEE_DEMO_VENUE_NAME);
    if (attendeeVenueId === undefined) {
      throw new Error(`Seed venue "${ATTENDEE_DEMO_VENUE_NAME}" was not inserted`);
    }

    const existingAttendeeEvents = await tx
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(
        and(
          eq(schema.eventRequests.organiserId, DEMO_EVENT_ORGANISER_ID),
          eq(schema.eventRequests.eventName, ATTENDEE_DEMO_EVENT_NAME)
        )
      )
      .limit(1)
      .for("update");

    // Keep this event one week after the other demo event so their windows do not overlap. Update
    // the dates on every run, as above. Keep registration open from yesterday until about 18 days
    // from now so the seeded attendee can show the registered state.
    const attendeeDate = futureOpenDayDate(27);
    const attendeeTiming = {
      proposedDates: [{ start: `${attendeeDate}T10:00`, end: `${attendeeDate}T16:00` }],
      registrationOpensAt: `${futureDate(-1)}T09:00`,
      registrationClosesAt: `${futureDate(18)}T17:00`,
    };
    const attendeeRequirements = {
      expectedAttendance: 30,
      venueRequirements: "Projector, video conferencing",
      roomLayoutPreference: "Classroom",
      accessibilityRequirements: "Step-free access",
    };

    // A confirmed event must record who decided and who confirmed it. The CHECK constraints
    // enforce this. Use the seeded Coordinator for both fields and update them on every run so an
    // older database does not keep incomplete values.
    const attendeeAttribution = {
      status: "confirmed" as const,
      decidedByCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
      decidedByCoordinatorName: "Seeded Event Coordinator",
      decidedAt: new Date(),
      confirmedById: DEMO_EVENT_COORDINATOR_ID,
      confirmedByName: "Seeded Event Coordinator",
      confirmedAt: new Date(),
    };

    let attendeeEventId = existingAttendeeEvents.at(0)?.id;
    if (attendeeEventId === undefined) {
      const [inserted] = await tx
        .insert(schema.eventRequests)
        .values({
          organiserId: DEMO_EVENT_ORGANISER_ID,
          submittedAt: new Date(),
          assignedCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
          assignedAt: new Date(),
          eventName: ATTENDEE_DEMO_EVENT_NAME,
          purpose: "Show attendees a confirmed event with registration open.",
          ...attendeeTiming,
          ...attendeeRequirements,
          ...attendeeAttribution,
          description:
            "An open day for new members: meet the organisers, tour the rooms, and try a workshop.",
          eventType: "Open Day",
          registrationEnabled: true,
          registrationCapacity: 40,
        })
        .returning({ id: schema.eventRequests.id });

      attendeeEventId = inserted.id;
    } else {
      // Update the registration terms too. A flag turned off by hand returns to its seeded value.
      await tx
        .update(schema.eventRequests)
        .set({
          ...attendeeTiming,
          ...attendeeRequirements,
          ...attendeeAttribution,
          submittedAt: sql`coalesce(${schema.eventRequests.submittedAt}, now())`,
          completedById: null,
          completedByName: null,
          completedAt: null,
          cancelledById: null,
          cancelledByName: null,
          cancelledAt: null,
          registrationEnabled: true,
          registrationCapacity: 40,
        })
        .where(eq(schema.eventRequests.id, attendeeEventId));
    }

    const attendeeVenueRequest = {
      venueId: attendeeVenueId,
      requestedById: DEMO_EVENT_COORDINATOR_ID,
      startsAt: `${attendeeDate} 10:00:00`,
      endsAt: `${attendeeDate} 16:00:00`,
      status: "approved" as const,
      assignedStaffId: null,
    };

    const existingAttendeeVenueRequests = await tx
      .select({ id: schema.venueRequests.id })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, "demo-attendee-venue-request-1"))
      .limit(1);

    if (existingAttendeeVenueRequests.length === 0) {
      await tx.insert(schema.venueRequests).values({
        id: "demo-attendee-venue-request-1",
        eventId: attendeeEventId,
        ...attendeeVenueRequest,
      });
    } else {
      await tx
        .update(schema.venueRequests)
        .set(attendeeVenueRequest)
        .where(eq(schema.venueRequests.id, "demo-attendee-venue-request-1"));
    }
    await syncSeedOccupancy(tx, {
      id: "demo-attendee-venue-request-1",
      eventId: attendeeEventId,
      venueId: attendeeVenueId,
      startsAt: attendeeVenueRequest.startsAt,
      endsAt: attendeeVenueRequest.endsAt,
      status: attendeeVenueRequest.status,
    });

    const projectorTypeId = equipmentTypeIdByName.get("Portable Projector");

    await tx
      .insert(schema.equipmentRequests)
      .values({
        id: "demo-equipment-request-1",
        eventId: demoRequestId,
        assignedStaffId: "seed-tech-support-1",
        item: "Projector",
        quantity: 1,
        equipmentTypeId: projectorTypeId ?? null,
        arrangementStatus: "reserved",
        notes: "HDMI adapter included",
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.eventRegistrations)
      .values({ eventId: demoRequestId, attendeeId: "test-user-1" })
      .onConflictDoNothing();
    await tx
      .insert(schema.eventRegistrations)
      .values({ eventId: attendeeEventId, attendeeId: "test-user-1" })
      .onConflictDoNothing();

    // Seed twenty extra events under the same advisory lock as the demos. Dates move forward
    // on every run, so existing rows converge instead of going stale. Each event keeps its
    // own venue date, so approved bookings never share a venue and a date.
    // oxlint-disable eslint/no-await-in-loop -- lookups must run sequentially under the lock
    for (const [index, extra] of seedExtraEvents.entries()) {
      const organiserId = seedExtraUsers[index * 2 + 1].id;
      const extraDate = futureOpenDayDate(extra.dayOffset);
      const extraTiming = {
        proposedDates: [{ start: `${extraDate}T10:00`, end: `${extraDate}T16:00` }],
        registrationOpensAt: `${futureDate(-1)}T09:00`,
        registrationClosesAt: `${futureDate(extra.dayOffset - 1)}T17:00`,
      };
      const extraRequirements = {
        expectedAttendance: extra.attendance,
        venueRequirements: "Projector, Wi-Fi",
        roomLayoutPreference: "Theatre seating",
        accessibilityRequirements: "Step-free access",
      };
      const extraAttribution =
        extra.status === "confirmed"
          ? {
              status: "confirmed" as const,
              decidedByCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
              decidedByCoordinatorName: "Seeded Event Coordinator",
              decidedAt: new Date(),
              confirmedById: DEMO_EVENT_COORDINATOR_ID,
              confirmedByName: "Seeded Event Coordinator",
              confirmedAt: new Date(),
            }
          : { status: "submitted" as const };

      const existing = await tx
        .select({ id: schema.eventRequests.id })
        .from(schema.eventRequests)
        .where(
          and(
            eq(schema.eventRequests.organiserId, organiserId),
            eq(schema.eventRequests.eventName, extra.name)
          )
        )
        .limit(1)
        .for("update");

      let extraEventId = existing.at(0)?.id;
      if (extraEventId === undefined) {
        const [inserted] = await tx
          .insert(schema.eventRequests)
          .values({
            organiserId,
            submittedAt: new Date(),
            assignedCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
            assignedAt: new Date(),
            eventName: extra.name,
            purpose: extra.purpose,
            ...extraTiming,
            ...extraRequirements,
            ...extraAttribution,
            description: extra.description,
            eventType: extra.type,
            registrationEnabled: true,
            registrationCapacity: extra.attendance + 15,
          })
          .returning({ id: schema.eventRequests.id });
        extraEventId = inserted.id;
      } else if (extra.status === "confirmed") {
        await tx
          .update(schema.eventRequests)
          .set({
            ...extraTiming,
            ...extraRequirements,
            ...extraAttribution,
            submittedAt: sql`coalesce(${schema.eventRequests.submittedAt}, now())`,
            // A hand-completed or hand-cancelled row converges back on re-run instead of
            // breaking the completion/cancellation CHECKs.
            completedById: null,
            completedByName: null,
            completedAt: null,
            cancelledById: null,
            cancelledByName: null,
            cancelledAt: null,
            registrationEnabled: true,
            registrationCapacity: extra.attendance + 15,
          })
          .where(eq(schema.eventRequests.id, extraEventId));
      } else {
        await tx
          .update(schema.eventRequests)
          .set({
            ...extraTiming,
            ...extraRequirements,
            status: "submitted",
            submittedAt: sql`coalesce(${schema.eventRequests.submittedAt}, now())`,
            decisionReason: null,
            decidedByCoordinatorId: null,
            decidedByCoordinatorName: null,
            decidedAt: null,
            confirmedById: null,
            confirmedByName: null,
            confirmedAt: null,
            completedById: null,
            completedByName: null,
            completedAt: null,
            cancelledById: null,
            cancelledByName: null,
            cancelledAt: null,
            registrationEnabled: true,
            registrationCapacity: extra.attendance + 15,
          })
          .where(eq(schema.eventRequests.id, extraEventId));
      }

      const extraVenueId = venueIdByName.get(extra.venueName);
      if (extraVenueId === undefined) {
        throw new Error(`Seed venue "${extra.venueName}" was not inserted`);
      }
      const venueRequestId = `seed-extra-venue-request-${String(index + 1).padStart(2, "0")}`;
      const extraVenueRequest = {
        venueId: extraVenueId,
        requestedById: DEMO_EVENT_COORDINATOR_ID,
        startsAt: `${extraDate} 10:00:00`,
        endsAt: `${extraDate} 16:00:00`,
        status: extra.status === "confirmed" ? ("approved" as const) : ("pending" as const),
        assignedStaffId: null,
      };
      const existingVenueRequest = await tx
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, venueRequestId))
        .limit(1);
      if (existingVenueRequest.length === 0) {
        await tx.insert(schema.venueRequests).values({
          id: venueRequestId,
          eventId: extraEventId,
          ...extraVenueRequest,
        });
      } else {
        await tx
          .update(schema.venueRequests)
          .set({ ...extraVenueRequest, eventId: extraEventId })
          .where(eq(schema.venueRequests.id, venueRequestId));
      }
      await syncSeedOccupancy(tx, {
        id: venueRequestId,
        eventId: extraEventId,
        venueId: extraVenueId,
        startsAt: extraVenueRequest.startsAt,
        endsAt: extraVenueRequest.endsAt,
        status: extraVenueRequest.status,
      });

      const equipmentRequestId = `seed-extra-equipment-request-${String(index + 1).padStart(2, "0")}`;
      const equipmentName = EXTRA_EQUIPMENT_ITEMS[index % EXTRA_EQUIPMENT_ITEMS.length];
      const extraEquipment = {
        eventId: extraEventId,
        assignedStaffId: "seed-tech-support-1",
        item: equipmentName,
        quantity: (index % 3) + 1,
        equipmentTypeId: equipmentTypeIdByName.get(equipmentName) ?? null,
        arrangementStatus:
          extra.status === "confirmed" ? ("reserved" as const) : ("requested" as const),
        notes: `Seeded for ${extra.name}`,
      };
      const existingEquipment = await tx
        .select({ id: schema.equipmentRequests.id })
        .from(schema.equipmentRequests)
        .where(eq(schema.equipmentRequests.id, equipmentRequestId))
        .limit(1);
      if (existingEquipment.length === 0) {
        await tx.insert(schema.equipmentRequests).values({
          id: equipmentRequestId,
          ...extraEquipment,
        });
      } else {
        await tx
          .update(schema.equipmentRequests)
          .set(extraEquipment)
          .where(eq(schema.equipmentRequests.id, equipmentRequestId));
      }

      if (extra.status === "confirmed") {
        for (let k = 0; k < 5; k += 1) {
          const attendee = seedExtraUsers[(index * 6 + k * 2) % seedExtraUsers.length];
          await tx
            .insert(schema.eventRegistrations)
            .values({ eventId: extraEventId, attendeeId: attendee.id })
            .onConflictDoNothing();
        }
      }
    }
  });
}

/**
 * Seeds the database using an existing Drizzle instance, a custom connection string,
 * or the default DATABASE_URL environment variable.
 */
export async function seed(databaseOrUrl?: Database | string): Promise<void> {
  if (databaseOrUrl && typeof databaseOrUrl !== "string") {
    await runSeed(databaseOrUrl);
    return;
  }

  const connectionString = databaseOrUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required for seeding");
  }

  const pool = new Pool({ connectionString });
  const database = drizzle(pool, { schema });

  try {
    await runSeed(database);
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  seed()
    .then(() => {
      console.info("Database seeded successfully.");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Database seed failed:", err);
      process.exit(1);
    });
}

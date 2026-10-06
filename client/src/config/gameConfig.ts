/**
 * Every tunable number in the game, in one place.
 *
 * Goalpost 1's whole purpose is answering the open questions in docs/mvp-scope.md —
 * how noisy is bike GPS, what threshold makes self-collision feel fair, how much
 * smoothing before the tail lags. Those answers are all changes to this file, so
 * it is deliberately the only place a magic number lives. The in-game debug
 * panel reports against these values so a test ride tells you what to change.
 */

export const GAME_CONFIG = {
  gps: {
    /**
     * Fixes worse than this (metres of reported accuracy) are dropped outright.
     * Portland's downtown core throws 40 m+ fixes between tall buildings; acting
     * on those is what produces phantom collisions.
     */
    maxAccuracyMeters: 30,

    /**
     * Fixes implying a speed above this (m/s) are treated as a GPS jump and
     * dropped. 22 m/s is ~80 km/h — unreachable on a bike, so anything faster is
     * the receiver relocating, not the rider moving.
     */
    maxPlausibleSpeedMps: 22,

    /**
     * Number of recent fixes averaged together. Higher is smoother but lags the
     * true position — at 5 m/s each extra sample is roughly a metre of lag.
     */
    smoothingWindow: 4,

    /**
     * Smoothed movement below this (metres) is treated as standing still. Stops
     * the tail from scribbling a knot around you while you wait at a light.
     */
    deadbandMeters: 2.5,

    /** watchPosition options while a game is active. */
    watchOptions: {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    } satisfies PositionOptions,
  },

  tail: {
    /**
     * The trail is limited by length, not by time: once it is longer than the
     * rider's budget it is trimmed from the oldest end. A time limit let a stuck
     * rider stand still until their whole trail expired and the map was clear;
     * a length limit only shrinks when the rider moves. The budget starts here
     * and grows with every power-up (`powerUps.lengthPerPickupMeters`).
     * Host-configurable at Goalpost 2.
     */
    startingLengthMeters: 500,

    /**
     * Minimum spacing between recorded tail vertices, in metres. Below this the
     * newest fix updates the live head instead of appending, which keeps the
     * point count proportional to distance ridden rather than to time elapsed.
     */
    minPointSpacingMeters: 6,

    /** Hard cap on retained vertices. At 6 m spacing this is ~30 km of tail. */
    maxPoints: 5000,
  },

  collision: {
    /**
     * How close (metres) the rider must come to an eligible tail segment to be
     * eliminated. Must comfortably exceed typical GPS error or crossings get
     * missed; too generous and riding parallel to your own tail kills you.
     */
    selfProximityMeters: 12,

    /**
     * Tail laid down within this many metres *behind* the rider cannot kill them.
     * Without it you would collide with the segment you are actively drawing.
     * Should exceed the turning radius of a bike at speed by a healthy margin.
     */
    graceMeters: 45,

    /**
     * Seconds after the game starts before collision is armed, so the rider
     * isn't eliminated by their own initial GPS scatter before moving off.
     */
    armingDelaySeconds: 5,

    /**
     * When true, elimination additionally requires the rider's recent heading to
     * be non-parallel to the tail segment they are near. This encodes the core
     * rule from docs/prd.md §10 — riding *along* a tail is legal, *crossing* it is
     * not — and is the single biggest defence against jitter false positives.
     */
    requireCrossing: true,

    /**
     * Minimum angle (degrees) between rider heading and tail segment bearing for
     * a crossing to count. 30° treats a shallow merge as parallel riding.
     */
    minCrossingAngleDegrees: 30,
  },

  /**
   * Play-zone boundary.
   *
   * Pulled forward from Goalpost 3 because without it the game has no
   * pressure: with a 3-minute tail TTL a rider can escape any developing
   * situation by riding in a straight line and simply waiting it out. A
   * bounded zone is what forces the doubling-back that creates the danger.
   *
   * Enforced client-side for now. It becomes server-authoritative at
   * Goalpost 3, per docs/prd.md section 13.
   */
  geofence: {
    /** Side length of the default box dropped around the rider, in metres. */
    defaultSizeMeters: 900,

    /** Smallest side the rider is allowed to shrink the box to, in metres. */
    minSideMeters: 200,

    /**
     * How long a rider may be outside the zone before elimination, in seconds.
     * Generous on purpose: GPS near a boundary is noisy, and a rider who
     * overshoots a turn needs a fair chance to come back.
     */
    graceSeconds: 20,

    /** Warn the rider when they come within this distance of the boundary. */
    warnWithinMeters: 60,
  },

  powerUps: {
    /** Default node count. The rider can change this on the setup screen. */
    defaultCount: 8,
    minCount: 0,
    maxCount: 20,

    /**
     * Ring the scatter falls within, in metres from the start position.
     * Only used when no play zone is set — with a zone, candidates are
     * sampled inside the zone instead.
     */
    minRadiusMeters: 150,
    maxRadiusMeters: 700,

    /**
     * Closest a node may be placed to the rider's start, in metres. A pickup
     * on the start line is collected before the rider has moved.
     */
    minDistanceFromStartMeters: 120,

    /** Collection radius in metres. docs/mvp-scope.md suggests ~15 m. */
    collectRadiusMeters: 15,

    /** Points awarded per pickup. */
    scorePerPickup: 100,

    /**
     * Metres added to the rider's trail budget per pickup. Collecting nodes
     * makes the trail longer and so the rider more dangerous to themselves —
     * the core risk/reward trade of the length-limited tail.
     */
    lengthPerPickupMeters: 150,

    /**
     * How far from a scattered candidate we will look for a rideable road or
     * path to snap it onto. Generous enough to escape open water and large
     * blocks; beyond this the candidate is abandoned rather than dragged
     * somewhere unrelated.
     */
    snapRadiusMeters: 250,

    /**
     * Candidates generated per node. Snapping pulls points toward the street
     * graph, so several candidates in a sector give a usable one to choose from
     * without ballooning the request count.
     */
    candidatesPerNode: 2,

    /**
     * Minimum spacing between placed nodes. Without this, snapping repeatedly
     * collapses neighbouring candidates onto the same arterial.
     */
    minSeparationMeters: 120,

    /**
     * OSM road classes a rider can legitimately reach. `service` is how OSM
     * tags alley cut-throughs and parking-lot aisles; `path` and `track` cover
     * park trails and greenways. Motorways, trunk roads, rail, ferries and
     * aerialways are excluded by not appearing here.
     */
    rideableRoadClasses: [
      'primary',
      'secondary',
      'tertiary',
      'street',
      'street_limited',
      'pedestrian',
      'path',
      'track',
      'service',
    ] as string[],

    /** Sub-types on otherwise-rideable classes that are not actually rideable. */
    excludedRoadTypes: [
      'steps',
      'driveway',
      'escalator',
      'elevator',
      'platform',
      'ferry',
    ] as string[],
  },

  map: {
    style: 'mapbox://styles/mapbox/dark-v11',
    /** Zoom used when the camera locks onto the rider. */
    followZoom: 16.5,
    /** Portland city centre — the map's home view before the first GPS fix. */
    fallbackCenter: { lng: -122.6784, lat: 45.5152 },
  },} as const;

export type GameConfig = typeof GAME_CONFIG;

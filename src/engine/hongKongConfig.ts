export const HKD = {
  initial: 38_000_000_000, train: 135_000_000, resale: 46_000_000, interchange: 390_000_000,
  capacity: 540, fare: 11, minimumFare: 0, maximumFare: 48, travelCostKm: 115, crewMinute: 37,
  stationMinute: 96, idleStationMinute: 11, idleTrainMinute: 12, harbourPerKm: 1_100_000_000,
  methods: {
    underground: { perKm: 1_220_000_000, station: 790_000_000, upkeepKmMinute: 17, speedKmh: 80, grade: Infinity, occupancy: Infinity },
    elevated: { perKm: 740_000_000, station: 430_000_000, upkeepKmMinute: 13, speedKmh: 74, grade: 0.19, occupancy: 0.78 },
    atGrade: { perKm: 340_000_000, station: 265_000_000, upkeepKmMinute: 8, speedKmh: 59, grade: 0.105, occupancy: 0.52 },
  },
} as const

export const trackMethods = ['underground', 'elevated', 'atGrade'] as const

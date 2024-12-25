export const QUICK_ACTION_MODES = ['Normal', 'Vacation', 'Eco', 'Comfort']
export const HEATING_COOLING_MODES = ['Heating', 'Cooling', 'Auto']

export const parseFirmwareDate = (date: number): string => {
  return String(date)
}

export const parseFirmwareTime = (time: number): string => {
  return String(time)
}

export const parseFirmwareVersion = (major: number, minor: number, revision: number): string => {
  return `${major}.${minor}.${revision}`
}

export const parseSerialNumber = (high: number, low: number): string => {
  return String(`${high}${low}`)
}

export const parseTemperature = (value: number): number => {
  return value / 10
}

export const parseHumidity = parseTemperature

export const encodeTemperature = (value: number): number => {
  return Math.round(value * 10)
}

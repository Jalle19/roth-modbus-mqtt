import ModbusRTU from 'modbus-serial'
import { createLogger } from './logger'
import { ReadCoilResult, ReadRegisterResult } from 'modbus-serial/ModbusRTU'
import { parseFirmwareDate, parseFirmwareTime, parseFirmwareVersion, parseSerialNumber } from './roth'

export enum ModbusDeviceType {
  RTU,
  TCP,
}

export type ModbusRtuDevice = {
  type: ModbusDeviceType
  path: string
}

export type ModbusTcpDevice = {
  type: ModbusDeviceType
  hostname: string
  port: number
}

type ModbusDevice = ModbusRtuDevice | ModbusTcpDevice

export type DeviceInformation = {
  firmwareDate: string
  firmwareTime: string
  firmwareVersion: string
  pcbVersion: number
  serialNumber: string
  bootloaderFirmwareVersion: string
  numZones: number
  numActuators: number
  numWindowSensors: number
}

type RuntimeDeviceInformation = {
  numZones: number
  numActuators: number
  numWindowSensors: number
}

export type ZoneValues = {
  isHeating: boolean
  currentTemperature: number
  humidity: number
  setTemperature: number
  batteryLevel: number
}

type Values = {
  mode: number
  heatCoolMode: number
  heatingCoolingStatus: boolean
  ecoInputStatus: boolean
  pumpStatus: boolean
  potentialFreeContactStatus: boolean
  zones: [...ZoneValues[]]
}

const logger = createLogger('modbus')

let runtimeDeviceInformation: RuntimeDeviceInformation = {
  numZones: 0,
  numActuators: 0,
  numWindowSensors: 0,
}

export const getDeviceInformation = async (modbusClient: ModbusRTU) => {
  logger.debug('Retrieving device information...')

  // Feature checks
  logger.info('Probing for features...')
  const numZones = await probeConfiguredZones(modbusClient)
  const numActuators = await probeConfiguredActuators(modbusClient)
  const numWindowSensors = await probeConfiguredWindowSensors(modbusClient)
  logger.debug(`Probed ${numZones} active zones, ${numActuators} actuators, ${numWindowSensors} window sensors`)

  let result = await tryReadHoldingRegisters(modbusClient, 1, 11)
  let deviceInformation: DeviceInformation = {
    'firmwareDate': parseFirmwareDate(result.data[0]),
    'firmwareTime': parseFirmwareTime(result.data[1]),
    'firmwareVersion': parseFirmwareVersion(result.data[2], result.data[3], result.data[4]),
    'pcbVersion': result.data[5],
    'serialNumber': parseSerialNumber(result.data[6], result.data[7]),
    'bootloaderFirmwareVersion': parseFirmwareVersion(result.data[8], result.data[9], result.data[10]),
    numZones,
    numActuators,
    numWindowSensors,
  }

  runtimeDeviceInformation = {
    numZones,
    numActuators,
    numWindowSensors,
  }

  return deviceInformation
}

export const getValues = async (modbusClient: ModbusRTU): Promise<Values> => {
  let result: ReadRegisterResult | ReadCoilResult

  result = await tryReadHoldingRegisters(modbusClient, 18, 1)
  const mode = result.data[0]

  result = await tryReadHoldingRegisters(modbusClient, 19, 1)
  const heatCoolMode = result.data[0]

  result = await tryReadCoils(modbusClient, 366, 1)
  const heatingCoolingStatus = result.data[0]
  result = await tryReadCoils(modbusClient, 370, 1)
  const ecoInputStatus = result.data[0]

  result = await tryReadCoils(modbusClient, 374, 1)
  const pumpStatus = result.data[0]
  result = await tryReadCoils(modbusClient, 378, 1)
  const potentialFreeContactStatus = result.data[0]

  let zoneHeatingResult = await tryReadHoldingRegisters(modbusClient, 71, 1)
  let zones = []

  for (let i = 0; i < runtimeDeviceInformation.numZones; i++) {
    const isHeating = Boolean(zoneHeatingResult.data[0] & (1 << i))

    result = await tryReadHoldingRegisters(modbusClient, 23 + i, 1)
    const currentTemperature = parseTemperature(result.data[0])

    result = await tryReadHoldingRegisters(modbusClient, 122 + i, 1)
    const humidity = parseHumidity(result.data[0])

    result = await tryReadHoldingRegisters(modbusClient, 221 + i, 1)
    const setTemperature = parseTemperature(result.data[0])

    result = await tryReadHoldingRegisters(modbusClient, 270 + i, 1)
    const batteryLevel = result.data[0]

    zones.push({
      isHeating,
      currentTemperature,
      humidity,
      setTemperature,
      batteryLevel,
    })
  }

  return {
    mode,
    heatCoolMode,
    heatingCoolingStatus,
    ecoInputStatus,
    pumpStatus,
    potentialFreeContactStatus,
    zones,
  }
}

const probeConfiguredZones = async (modbusClient: ModbusRTU): Promise<number> => {
  let zone

  for (zone = 0; zone < 48; zone++) {
    try {
      await tryReadHoldingRegisters(modbusClient, 23 + zone, 1)
    } catch (e) {
      return zone
    }
  }

  return 0
}

const probeConfiguredActuators = async (modbusClient: ModbusRTU): Promise<number> => {
  let actuator

  for (actuator = 0; actuator < 48; actuator++) {
    try {
      await tryReadHoldingRegisters(modbusClient, 170 + actuator, 1)
    } catch (e) {
      return actuator
    }
  }

  return 0
}

const probeConfiguredWindowSensors = async (modbusClient: ModbusRTU): Promise<number> => {
  let windowSensor

  for (windowSensor = 0; windowSensor < 48; windowSensor++) {
    try {
      await tryReadHoldingRegisters(modbusClient, 218 + windowSensor, 1)
    } catch (e) {
      return windowSensor
    }
  }

  return 0
}

const parseTemperature = (value: number): number => {
  return value / 10
}

const parseHumidity = parseTemperature

export const validateDevice = (device: string): boolean => {
  return device.startsWith('/') || device.startsWith('tcp://')
}

export const parseDevice = (device: string): ModbusDevice => {
  if (device.startsWith('/')) {
    // Serial device
    return {
      type: ModbusDeviceType.RTU,
      path: device,
    }
  } else {
    // TCP URL
    const deviceUrl = new URL(device)
    return {
      type: ModbusDeviceType.TCP,
      hostname: deviceUrl.hostname,
      port: parseInt(deviceUrl.port, 10),
    }
  }
}

const tryReadCoils = async (modbusClient: ModbusRTU, dataAddress: number, length: number): Promise<ReadCoilResult> => {
  try {
    logger.debug(`Reading coil address ${dataAddress}, length ${length}`)
    return await modbusClient.readCoils(dataAddress, length)
  } catch (e) {
    logger.error(`Failed to read coil address ${dataAddress}, length ${length}`)
    throw e
  }
}

const tryReadHoldingRegisters = async (
  modbusClient: ModbusRTU,
  dataAddress: number,
  length: number,
): Promise<ReadRegisterResult> => {
  try {
    logger.debug(`Reading holding register address ${dataAddress}, length ${length}`)
    return await modbusClient.readHoldingRegisters(dataAddress, length)
  } catch (e) {
    logger.error(`Failed to read holding register address ${dataAddress}, length ${length}`)
    throw e
  }
}

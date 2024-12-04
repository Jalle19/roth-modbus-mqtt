import ModbusRTU from 'modbus-serial'
import { IClientPublishOptions, MqttClient } from 'mqtt'
import { createLogger } from './logger'
import { DeviceInformation, getValues, setHeatCoolMode, setMode, setZoneTemperature, ZoneValues } from './modbus'

type TopicValueMap = Record<string, string>

export const TOPIC_PREFIX = 'roth-modbus-mqtt'
export const TOPIC_PREFIX_DEVICE_INFORMATION = `${TOPIC_PREFIX}/deviceInformation`
export const TOPIC_PREFIX_STATUS = `${TOPIC_PREFIX}/status`
export const TOPIC_PREFIX_ZONE = `${TOPIC_PREFIX_STATUS}/zone`
export const TOPIC_NAME_STATUS = `${TOPIC_PREFIX}/status`

const logger = createLogger('mqtt')

export const publishDeviceInformation = async (deviceInformation: DeviceInformation, mqttClient: MqttClient) => {
  let topicValueMap: TopicValueMap = {}

  for (const [item, value] of Object.entries(deviceInformation)) {
    const topicName = `${TOPIC_PREFIX_DEVICE_INFORMATION}/${item}`
    topicValueMap[topicName] = JSON.stringify(value)
  }

  logger.debug('Publising device information...')

  // Retain the values, they never change
  await publishTopics(mqttClient, topicValueMap, {
    retain: true,
  })
}

export const publishValues = async (modbusClient: ModbusRTU, mqttClient: MqttClient) => {
  let topicMap: TopicValueMap = {
    [TOPIC_NAME_STATUS]: 'online',
  }

  const values = await getValues(modbusClient)

  for (const [name, value] of Object.entries(values)) {
    if (name !== 'zones') {
      const topicName = `${TOPIC_PREFIX_STATUS}/${name}`
      topicMap[topicName] = JSON.stringify(value)
    } else {
      const zones = value as ZoneValues[]

      for (const [i, zone] of zones.entries()) {
        for (const [zoneName, zoneValue] of Object.entries(zone)) {
          const topicName = `${TOPIC_PREFIX_ZONE}/${i + 1}/${zoneName}`
          topicMap[topicName] = JSON.stringify(zoneValue)
        }
      }
    }
  }

  logger.debug('Publishing status and zones...')

  await publishTopics(mqttClient, topicMap)
}

export const subscribeTopics = async (mqttClient: MqttClient) => {
  // Subscribe to writable topics
  const topicNames = [`${TOPIC_PREFIX_STATUS}/+/set`, `${TOPIC_PREFIX_ZONE}/+/+/set`]

  for (const topicName of topicNames) {
    logger.info(`Subscribing to topic(s) ${topicName}`)

    await mqttClient.subscribeAsync(topicName)
  }
}

export const handlePublishedMessage = async (
  modbusClient: ModbusRTU,
  mqttClient: MqttClient,
  topicName: string,
  payload: unknown,
) => {
  logger.info(`Received ${payload} on topic ${topicName}`)

  if (topicName.startsWith(TOPIC_PREFIX_ZONE)) {
    const partialTopic = topicName.substring(TOPIC_PREFIX_ZONE.length + 1)
    const [zone, setting, ,] = partialTopic.split('/')

    if (setting === 'setTemperature') {
      logger.info(`Changing zone ${zone} temperature to ${payload}`)
      await setZoneTemperature(modbusClient, parseInt(zone, 10), payload as number)
    } else {
      logger.error(`Unknown setting ${setting} received`)
    }
  } else if (topicName.startsWith(TOPIC_PREFIX_STATUS)) {
    const partialTopic = topicName.substring(TOPIC_PREFIX_STATUS.length + 1)
    const [setting] = partialTopic.split('/')

    logger.info(`Setting setting ${setting} to ${payload}`)

    switch (setting) {
      case 'mode':
        await setMode(modbusClient, payload as number)
        break
      case 'heatCoolMode':
        await setHeatCoolMode(modbusClient, payload as number)
        break
      default:
        logger.error(`Unknown setting ${setting}`)
    }
  }
}

const publishTopics = async (
  mqttClient: MqttClient,
  topicMap: TopicValueMap,
  publishOptions: IClientPublishOptions = {},
) => {
  const publishPromises = []

  for (const [topic, value] of Object.entries(topicMap)) {
    logger.debug(`Publishing ${value} to ${topic}`)
    publishPromises.push(mqttClient.publishAsync(topic, value, publishOptions))
  }

  await Promise.all(publishPromises)
}

export const validateBrokerUrl = (brokerUrl: string): boolean => {
  return brokerUrl.startsWith('mqtt://') || brokerUrl.startsWith('mqtts://')
}

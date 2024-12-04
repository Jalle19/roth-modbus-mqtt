import ModbusRTU from "modbus-serial";
import { IClientPublishOptions, MqttClient } from "mqtt";
import { createLogger } from "./logger";
import { getDeviceInformation, getValues, ZoneValues } from "./modbus";

type TopicValueMap = Record<string, string>

export const TOPIC_PREFIX = 'roth-modbus-mqtt'
export const TOPIC_PREFIX_DEVICE_INFORMATION = `${TOPIC_PREFIX}/deviceInformation`
export const TOPIC_PREFIX_STATUS = `${TOPIC_PREFIX}/status`
export const TOPIC_PREFIX_ZONE = `${TOPIC_PREFIX_STATUS}/zone`
export const TOPIC_NAME_STATUS = `${TOPIC_PREFIX}/status`

const logger = createLogger('mqtt')

export const publishDeviceInformation = async (modbusClient: ModbusRTU, mqttClient: MqttClient) => {
  let topicValueMap: TopicValueMap = {}

  const deviceInformation = await getDeviceInformation(modbusClient)

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

const publishTopics = async (mqttClient: MqttClient, topicMap: TopicValueMap, publishOptions: IClientPublishOptions = {}) => {
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

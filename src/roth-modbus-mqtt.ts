import yargs from 'yargs'
import { createLogger, setLogLevel } from './logger'
import {
  getDeviceInformation,
  ModbusDeviceType,
  ModbusRtuDevice,
  ModbusTcpDevice,
  parseDevice,
  probePeripherals,
  validateDevice,
} from './modbus'
import ModbusRTU from 'modbus-serial'
import {
  handlePublishedMessage,
  publishDeviceInformation,
  publishValues,
  subscribeTopics,
  validateBrokerUrl,
} from './mqtt'
import { connectAsync } from 'mqtt'
import { configureMqttDiscovery } from './homeassistant'
import { setIntervalAsync } from 'set-interval-async'

const argv = yargs(process.argv.slice(2))
  .usage('node $0 [options]')
  .options({
    'device': {
      type: 'string',
      description:
        'The Modbus device to use, e.g. /dev/ttyUSB0 for Modbus RTU or tcp://192.168.1.40:502 for Modbus TCP',
      demandOption: true,
      alias: 'd',
    },
    'modbusSlave': {
      type: 'number',
      description: 'The Modbus slave address',
      default: 1,
      alias: 's',
    },
    'mqttBrokerUrl': {
      type: 'string',
      description: 'The URL to the MQTT broker, e.g. mqtt://localhost:1883.',
      demandOption: true,
      alias: 'm',
    },
    'mqttUsername': {
      type: 'string',
      description: 'The username to use when connecting to the MQTT broker. Omit to disable authentication.',
      default: undefined,
    },
    'mqttPassword': {
      type: 'string',
      description:
        'The password to use when connecting to the MQTT broker. Required when mqttUsername is defined. Omit to disable authentication.',
      default: undefined,
    },
    'mqttPublishInterval': {
      type: 'number',
      description: 'How often messages should be published over MQTT (in seconds)',
      default: 10,
      alias: 'i',
    },
    'mqttDiscovery': {
      description: 'Whether to enable Home Assistant MQTT discovery support.',
      type: 'boolean',
      default: true,
    },
    'probePeripheralsInterval': {
      description:
        'How often (in minutes) the controller should be probed for available peripherals (zones, actuators etc.)',
      type: 'number',
      default: 10,
    },
    'debug': {
      description: 'Enable debug logging',
      type: 'boolean',
      default: false,
      alias: 'v',
    },
  })
  .parseSync()

void (async () => {
  const logger = createLogger('main')
  if (argv.debug) {
    setLogLevel(logger, 'debug')
  }

  if (!validateDevice(argv.device)) {
    logger.error(`Malformed Modbus device ${argv.device} specified, exiting`)
    process.exit(1)
  }

  if (!validateBrokerUrl(argv.mqttBrokerUrl)) {
    logger.error(`Malformed MQTT broker URL: ${argv.mqttBrokerUrl}. Should be e.g. mqtt://localhost:1883.`)
  }

  const modbusDevice = parseDevice(argv.device)
  const modbusClient = new ModbusRTU()
  modbusClient.setID(argv.modbusSlave)
  modbusClient.setTimeout(5000) // 5 seconds

  // Use buffered RTU or TCP depending on device type
  if (modbusDevice.type === ModbusDeviceType.RTU) {
    const device = modbusDevice as ModbusRtuDevice
    await modbusClient.connectRTUBuffered(device.path, {
      baudRate: 19200,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
    })
  } else if (modbusDevice.type === ModbusDeviceType.TCP) {
    const device = modbusDevice as ModbusTcpDevice
    logger.info(`Connecting to ${device.hostname}:${device.port}`)

    await modbusClient.connectTCP(device.hostname, {
      port: device.port,
      timeout: 5,
    })
  }

  logger.info(`Connecting to MQTT broker at ${argv.mqttBrokerUrl}`)

  // Handle authentication
  let clientOptions = {}

  if (argv.mqttUsername && argv.mqttPassword) {
    clientOptions = {
      'username': argv.mqttUsername,
      'password': argv.mqttPassword,
    }
  }

  const mqttClient = await connectAsync(argv.mqttBrokerUrl, clientOptions)
  logger.info(`Successfully connected to MQTT broker at ${argv.mqttBrokerUrl}`)

  // Publish device information once, since it's mostly static and doesn't change.
  const deviceInformation = await getDeviceInformation(modbusClient)
  await publishDeviceInformation(deviceInformation, mqttClient)

  // Regularly probe for peripherals (to account for transient read errors during early startup of the controller,
  // which can lead to the number of devices being found to be incorrect)
  setIntervalAsync(
    async () => {
      await probePeripherals(modbusClient)
    },
    argv.probePeripheralsInterval * 60 * 1000,
  )

  // Publish readings/settings/modes/alarms once immediately, then regularly according to the configured
  // interval.
  await publishValues(modbusClient, mqttClient)
  setIntervalAsync(async () => {
    await publishValues(modbusClient, mqttClient)
  }, argv.mqttPublishInterval * 1000)

  logger.info(`MQTT scheduler started, will publish readings every ${argv.mqttPublishInterval} seconds`)

  await configureMqttDiscovery(deviceInformation, mqttClient)
  logger.info('Finished configuration Home Assistant MQTT discovery')

  // Subscribe to changes and register a handler
  await subscribeTopics(mqttClient)
  mqttClient.on('message', (topicName, payload) => {
    void handlePublishedMessage(modbusClient, topicName, payload)
  })

  // Log reconnection attempts
  mqttClient.on('reconnect', () => {
    logger.info(`Attempting to reconnect to ${argv.mqttBrokerUrl}`)
  })
})()

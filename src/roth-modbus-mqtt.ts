import yargs from 'yargs'
import { createLogger, setLogLevel } from "./logger";
import { ModbusDeviceType, ModbusRtuDevice, ModbusTcpDevice, parseDevice, validateDevice } from "./modbus";
import ModbusRTU from "modbus-serial";
import { publishDeviceInformation, publishValues, validateBrokerUrl } from "./mqtt";
import { connectAsync } from "mqtt";
import { configureMqttDiscovery } from "./homeassistant";

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
        description:
            'Whether to enable Home Assistant MQTT discovery support.',
        type: 'boolean',
        default: true,
      },
      'debug': {
        description: 'Enable debug logging',
        type: 'boolean',
        default: false,
        alias: 'v',
      },
    }).parseSync()

;(async () => {
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

  // Publish device information once only (since it doesn't change)
  await publishDeviceInformation(modbusClient, mqttClient)

  // Publish readings/settings/modes/alarms once immediately, then regularly according to the configured
  // interval.
  await publishValues(modbusClient, mqttClient)
  setInterval(async () => {
    await publishValues(modbusClient, mqttClient)
  }, argv.mqttPublishInterval * 1000)

  logger.info(`MQTT scheduler started, will publish readings every ${argv.mqttPublishInterval} seconds`)

  await configureMqttDiscovery(modbusClient, mqttClient)
  logger.info('Finished configuration Home Assistant MQTT discovery')

  // Subscribe to changes and register a handler
  // await subscribeToChanges(modbusClient, mqttClient)
  // mqttClient.on('message', async (topicName, payload) => {
  //   await handleMessage(modbusClient, mqttClient, topicName, payload)
  // })
  //
  // // Optionally configure Home Assistant MQTT discovery
  // if (argv.mqttDiscovery) {
  //   await configureMqttDiscovery(modbusClient, mqttClient)
  //   logger.info('Finished configuration Home Assistant MQTT discovery')
  // }

  // Log reconnection attempts
  mqttClient.on('reconnect', () => {
    logger.info(`Attempting to reconnect to ${argv.mqttBrokerUrl}`)
  })
})()

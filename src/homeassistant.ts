import { DeviceInformation } from './modbus'
import { TOPIC_NAME_STATUS, TOPIC_PREFIX_DEVICE_INFORMATION, TOPIC_PREFIX_STATUS, TOPIC_PREFIX_ZONE } from './mqtt'
import { createLogger } from './logger'
import { MqttClient } from 'mqtt'
import { HEATING_COOLING_MODES, QUICK_ACTION_MODES } from './roth'

const logger = createLogger('homeassistant')

export const configureMqttDiscovery = async (deviceInformation: DeviceInformation, mqttClient: MqttClient) => {
  const deviceIdentifier = createDeviceIdentifierString(deviceInformation)

  // The "device" object that is part of each sensor's configuration payload
  const mqttDeviceInformation = {
    'identifiers': deviceIdentifier,
    'name': `Roth Touchline SL`,
    'hw_version': deviceInformation.pcbVersion,
    'sw_version': deviceInformation.firmwareVersion,
    'serial_number': deviceInformation.serialNumber,
    'model': 'Touchline SL',
    'manufacturer': 'Roth',
  }

  const configurationBase = {
    'platform': 'mqtt',
    'availability_topic': TOPIC_NAME_STATUS,
    'device': mqttDeviceInformation,
  }

  // Binary sensors
  let binarySensorConfigurationMap = {
    'heatingCoolingStatus': createBinarySensorConfiguration(
      configurationBase,
      'heatingCoolingStatus',
      'Heating/cooling',
      { 'icon': 'mdi:hvac' },
    ),
    'ecoInput': createBinarySensorConfiguration(configurationBase, 'ecoInputStatus', 'Eco input', {
      'icon': 'mdi:sprout',
    }),
    'pump': createBinarySensorConfiguration(configurationBase, 'pumpStatus', 'Pump', { 'icon': 'mdi:pump' }),
    'potentialFreeContact': createBinarySensorConfiguration(
      configurationBase,
      'potentialFreeContactStatus',
      'Potential-free contact',
      { 'icon': 'mdi:electric-switch' },
    ),
  }

  // Selects
  const selectConfigurationMap = {
    'mode': createSelectConfiguration(configurationBase, 'mode', 'Quick action mode', QUICK_ACTION_MODES),
    'heatCoolMode': createSelectConfiguration(
      configurationBase,
      'heatCoolMode',
      'Heating/cooling mode',
      HEATING_COOLING_MODES,
    ),
  }

  let sensorConfigurationMap = {
    'numZones': createDiagnosticSensorConfiguration(configurationBase, 'numZones', 'Number of zones'),
    'numActuators': createDiagnosticSensorConfiguration(configurationBase, 'numActuators', 'Number of actuators'),
    'numWindowSensors': createDiagnosticSensorConfiguration(
      configurationBase,
      'numWindowSensors',
      'Number of window sensors',
    ),
  }

  let hvacConfigurationMap = {}

  // Various repeated sensors for each zone
  for (let i = 0; i < deviceInformation.numZones; i++) {
    const zone = i + 1

    binarySensorConfigurationMap = {
      ...binarySensorConfigurationMap,
      [`zone${zone}Heating`]: createZoneBinarySensorConfiguration(
        configurationBase,
        zone,
        'isHeating',
        `Zone ${zone} heating`,
      ),
    }

    sensorConfigurationMap = {
      ...sensorConfigurationMap,
      [`zone${zone}BatteryLevel`]: createZoneBatterySensorConfiguration(
        configurationBase,
        zone,
        'batteryLevel',
        `Zone ${zone} battery level`,
      ),
    }

    hvacConfigurationMap = {
      ...hvacConfigurationMap,
      [`zone${zone}Hvac`]: createZoneHvacConfiguration(configurationBase, zone, `Zone ${zone} thermostat`),
    }
  }

  // Final map that describes everything we want to be auto-discovered
  const configurationMap = {
    'sensor': sensorConfigurationMap,
    'binary_sensor': binarySensorConfigurationMap,
    'select': selectConfigurationMap,
    'climate': hvacConfigurationMap,
  }

  // Publish configurations
  for (const [entityType, entityConfigurationMap] of Object.entries(configurationMap)) {
    for (const [entityName, configuration] of Object.entries(entityConfigurationMap)) {
      const configurationTopicName = `homeassistant/${entityType}/${deviceIdentifier}/${entityName}/config`

      // "retain" is used so that the entities will be available immediately after a Home Assistant restart
      logger.debug(`Publishing Home Assistant auto-discovery configuration for ${entityType} "${entityName}"...`)
      await mqttClient.publishAsync(configurationTopicName, JSON.stringify(configuration), {
        retain: true,
      })
    }
  }
}

export const createDeviceIdentifierString = (modbusDeviceInformation: DeviceInformation): string => {
  return `roth-${modbusDeviceInformation.serialNumber}`
}

const createBinarySensorConfiguration = (
  configurationBase: object,
  statusName: string,
  entityName: string,
  extraProperties = {},
) => {
  return {
    ...configurationBase,
    'unique_id': `roth-${statusName}`,
    'name': entityName,
    'object_id': `roth_${statusName}`,
    'state_topic': `${TOPIC_PREFIX_STATUS}/${statusName}`,
    'payload_on': 'true',
    'payload_off': 'false',
    ...extraProperties,
  }
}

const createSelectConfiguration = (
  configurationBase: object,
  selectName: string,
  entityName: string,
  options: string[],
) => {
  return {
    ...configurationBase,
    'unique_id': `roth-${selectName}`,
    'name': entityName,
    'object_id': `roth_${selectName}`,
    'options': options,
    'state_topic': `${TOPIC_PREFIX_STATUS}/${selectName}`,
    'command_topic': `${TOPIC_PREFIX_STATUS}/${selectName}/set`,
    'command_template': '{{ this.attributes.options.index(value) }}',
    'value_template': '{{ this.attributes.options[(value | int)] }}',
  }
}

const createDiagnosticSensorConfiguration = (configurationBase: object, diagnosticName: string, entityName: string) => {
  return {
    ...configurationBase,
    'unique_id': `roth-${diagnosticName}`,
    'name': entityName,
    'object_id': `roth_${diagnosticName}`,
    'state_topic': `${TOPIC_PREFIX_DEVICE_INFORMATION}/${diagnosticName}`,
    'entity_category': 'diagnostic',
  }
}

const createZoneBinarySensorConfiguration = (
  configurationBase: object,
  zone: number,
  statusName: string,
  entityName: string,
) => {
  return {
    ...configurationBase,
    'unique_id': `roth-zone${zone}-${statusName}`,
    'name': entityName,
    'object_id': `roth_zone${zone}_${statusName}`,
    'state_topic': `${TOPIC_PREFIX_ZONE}/${zone}/${statusName}`,
    'payload_on': 'true',
    'payload_off': 'false',
    'icon': 'mdi:heat-wave',
  }
}

const createZoneBatterySensorConfiguration = (
  configurationBase: object,
  zone: number,
  statusName: string,
  entityName: string,
) => {
  return {
    ...configurationBase,
    'unique_id': `roth-zone${zone}-${statusName}`,
    'name': entityName,
    'object_id': `roth_zone${zone}_${statusName}`,
    'state_topic': `${TOPIC_PREFIX_ZONE}/${zone}/${statusName}`,
    'state_class': 'measurement',
    'device_class': 'battery',
    'unit_of_measurement': '%',
  }
}

const createZoneHvacConfiguration = (configurationBase: object, zone: number, entityName: string) => {
  return {
    ...configurationBase,
    'unique_id': `roth-zone${zone}-hvac`,
    'name': entityName,
    'object_id': `roth_zone${zone}_hvac`,
    'current_humidity_topic': `${TOPIC_PREFIX_ZONE}/${zone}/humidity`,
    'current_temperature_topic': `${TOPIC_PREFIX_ZONE}/${zone}/currentTemperature`,
    'temperature_state_topic': `${TOPIC_PREFIX_ZONE}/${zone}/setTemperature`,
    'temperature_command_topic': `${TOPIC_PREFIX_ZONE}/${zone}/setTemperature/set`,
    'mode_state_topic': `${TOPIC_PREFIX_ZONE}/${zone}/isHeating`,
    'mode_state_template': '{{ "auto" if value == "true" else "off" }}',
    'modes': ['off', 'auto'],
    'temperature_unit': 'C',
  }
}

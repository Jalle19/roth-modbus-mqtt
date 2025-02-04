# Change log

## 0.3.0

* Changed `entity_category` to `config` for select entities
* Add `--probePeripheralsInterval` option for controlling how often peripherals are probed during runtime
* Add an MQTT button for triggering a peripheral probe (https://github.com/Jalle19/roth-modbus-mqtt/issues/11)

## 0.2.0

* Added binary sensors for each zone indicating whether there is a communication issue with the thermostat
* Use `"None"` instead of `null` in MQTT messages
* Fix crash when zero zones are configured

## 0.1.1

* Publish `null` when a thermostat reports maximum values for temperature and humidity (https://github.com/Jalle19/roth-modbus-mqtt/pull/6)

## 0.1.0

* Initial release, works for general usage

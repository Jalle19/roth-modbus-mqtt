# roth-modbus-mqtt

A Modbus to MQTT proxy for modern Roth Touchline SL floor heating controllers.

## Unsupported features

The following features are unsupported since I don't have the required hardware:

- floor temperature sensors
- actuators
- window sensors
- extension units (zones 9-48)

## Installation

The following instructions assume you're running as `root`.

1. Clone the repository to `/opt`
2. Run `systemctl enable /opt/roth-modbus-mqtt/systemd/roth-modbus-mqtt.service`
3. Run `systemctl edit roth-modbus-mqtt`, then add a section like this:

```
[Service]
ExecStart=/usr/bin/node /opt/roth-modbus-mqtt/dist/roth-modbus-mqtt.js -d tcp://192.168.1.209:502 -m mqtt://192.168.1.210:1883
```

4. Run `systemctl start roth-modbus-mqtt`

If everything runs correctly and your Home Assistant is configured to use the same MQTT broker, a new 
device should appear under the MQTT integration.

## License

GNU GENERAL PUBLIC LICENSE Version 3

# companion-module-sonifex-avn-m8r

Companion module for the Sonifex AVN-M8R, an 8-channel mic/line input Dante interface with dual PoE.

- Live metering of all 8 mic/line inputs, including meter gauge presets
- 53 presets for input control, metering and device monitoring
- 117 variables exposing input settings, meter levels and device status for customisation

## Configuration

Enter the unit's IP address in **Device IP**. See [the module help](companion/HELP.md) for details of the available actions and feedbacks.

## Communication Interfaces

### WebSocket

Live updates are received over WebSocket, including:

- Meter data for all 8 inputs
- Device uptime
- Device temperature
- Primary and secondary PoE presence
- Status LEDs enabled/disabled state

The WebSocket interface also enables or disables the device's status LEDs.

### HTTP

The module also polls the device's `devInfo.cgi` endpoint for uptime, core temperature and PoE presence.

### Ember+

Ember+ controls and monitors the following input settings:

- Preamp gain
- Full-scale level
- High-pass filter frequency and state
- Input mode (Mic/Line)
- Input mute
- Phantom power
- Signal-presence threshold and timeout

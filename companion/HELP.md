## Sonifex AVN-M8R - Companion Module

Control and monitor the Sonifex AVN-M8R.

### Configuration

- Enter the unit's IP address in **Device IP**.
- Companion must be able to reach the device on TCP ports **9000** (Ember+), **8081** (WebSocket), and **80** (HTTP).

Input controls use Ember+. Metering, input names, GPI mute and status LEDs use WebSocket. Device uptime, core temperature and PoE presence are received over WebSocket and polled over HTTP every 30 seconds.

### Actions

Input settings (Mic/Line mode, phantom power, preamp gain, full-scale level, high-pass filter, signal-presence timeout and threshold, and mute) are controlled using Ember+.

Select Input 1 to Input 8 for each input action.

| Action                         | Available settings                                                    |
| ------------------------------ | --------------------------------------------------------------------- |
| Set Input Mode                 | Mic or Line                                                           |
| Set Phantom Power              | Off, On or Toggle                                                     |
| Set Preamp Gain                | 16 to 76 dB in 3 dB steps                                             |
| Adjust Preamp Gain             | Increase or decrease by 3, 6, 12, 15 or 30 dB, limited to 16 to 76 dB |
| Set Full Scale Level           | +15, +18, +20, +22 or +24 dBu                                         |
| Set High-Pass Filter State     | Off, On or Toggle                                                     |
| Set High-Pass Filter Frequency | 40 to 3000 Hz in 5 Hz steps                                           |
| Set Signal-Presence Timeout    | 0 to 300 seconds                                                      |
| Set Signal-Presence Threshold  | -70 to 0 dBFS                                                         |
| Set Input Mute                 | Unmuted, Muted or Toggle (software mute)                              |
| Set Status LEDs                | Disabled, Enabled or Toggle                                           |

**Set Status LEDs** applies to the whole device and uses WebSocket. Toggle actions and relative gain adjustments require the current setting to have been received from the device.

### Feedbacks

- **Ember+ Parameter** compares a selected input setting against a value. Use **Learn** to copy the current value. Boolean settings use `0` or `1`, input mode uses `0` for Mic and `1` for Line, full-scale level uses `0` to `4` for +15, +18, +20, +22 and +24 dBu respectively.
- **Input Mute** offers _Software only_, _GPI only_, or _Software or GPI_, with a choice of Muted or Unmuted.
- **Input Meter Level** compares the input level with `<`, `=` or `>` against a level in dBFS.
- **PoE Input** reports whether the Primary or Secondary PoE input is present or absent.
- **Status LEDs** reports whether the status LEDs are enabled or disabled.

### Metering

Input levels are reported as a segment count from **0 to 21**, rather than a continuous dBFS measurement. Zero means below -52 dBFS, segment 21 represents the top band starting at -0.1 dBFS. Only the levels listed in **Input Meter Level** can be distinguished. Its `=` comparison matches a meter band, rather than an exact measured dBFS value.

For a custom gauge, use `input1_meter` (or the corresponding input variable) with a minimum of **0** and a maximum of **21**.

### Software and GPI mute

**Set Input Mute** Action changes only the software mute. An input remains muted while either software mute or GPI mute is active, so clearing software mute cannot override an active GPI mute.

Use the **Input Mute** feedback's _Software or GPI_ source to show the combined state. The mute preset toggles software mute and shows red when muted, with amber taking priority while GPI mute is active.

### Variables

The module provides the following variables for each input. Replace `input1` with `input2` through `input8` as required.

| Variables                                                            | Contents                                     |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `input1_dante_label`, `input1_friendly_name`                         | Input names reported by the device           |
| `input1_mode`                                                        | Mic or Line                                  |
| `input1_phantom_power`                                               | Phantom power state                          |
| `input1_preamp_gain`                                                 | Preamp gain in dB                            |
| `input1_full_scale_level`                                            | Full-scale level, including dBu units        |
| `input1_hpf_enabled`, `input1_hpf_frequency`                         | High-pass filter state and frequency in Hz   |
| `input1_signal_presence_timeout`, `input1_signal_presence_threshold` | Signal-presence settings in seconds and dBFS |
| `input1_mute`, `input1_gpi_mute`, `input1_mute_active`               | Software, GPI and combined mute states       |
| `input1_meter`                                                       | Meter segment count, 0 to 21                 |

Device variables are `status_leds_enabled` (`0` or `1`), `device_uptime`, `device_temperature` (degrees Celsius), `primary_poe_present` and `secondary_poe_present` (`Present` or `Not Present`).

### Presets

- **Inputs:** software mute toggle, phantom power toggle and a two-step Mic/Line button for each input.
- **Metering:** meter gauges, signal-present indicators and clip indicators for each input. Signal-present indicators light above the zero meter band, clip indicators light at segment 21. These indicators use meter data, independently of the signal-presence timeout and threshold settings.
- **Device:** status LED toggle, primary and secondary PoE failure indicators, core temperature and uptime.

### Connection troubleshooting

The module automatically retries dropped WebSocket or Ember+ connections. If meters update but input actions fail, check access to Ember+ on port 9000 and review the Companion log for parameter discovery or connection errors. If temperature, uptime or PoE information is missing, check access to the device's HTTP and WebSocket interfaces.

## Sonifex AVN-M8R

Control and monitor the Sonifex AVN-M8R.

### Configuration

- **Device IP** is the unit's IP address.

### Actions

Input settings (mic/line mode, phantom power, preamp gain, full scale level, high-pass filter,
signal-presence timeout and threshold, mute) are controlled using Ember+.

**Set Preamp Gain** selects an absolute value. **Adjust Preamp Gain** steps up or down. The preamp
accepts 16 to 76 dB in 3 dB steps only, so the Gain Step option is expressed in whole steps.

**Set Status LEDs** is communicated via the WebSocket interface rather than Ember+.

### Feedbacks

- **Ember+ Parameter** compares any input parameter against a value, and supports Learn.
- **Input Mute** offers _Software only_, _GPI only_, or _Software or GPI_. See the note below.
- **Input Meter Level** compares the meter with `<`, `=` or `>` against a level in dBFS.
- **PoE Input** covers Primary or Secondary, present or not present.
- **Status LEDs** is enabled or disabled.

### Metering

The meter is reported in 21 spaced segements every 80 ms. Only the levels listed in the feedback can
be distinguished.
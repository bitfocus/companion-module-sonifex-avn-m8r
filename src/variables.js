module.exports = function (self) {
	const definitions = {
		status_leds_enabled: { name: 'Status LEDs enabled' },
		device_uptime: { name: 'Device uptime' },
		device_temperature: { name: 'Device core temperature (°C)' },
		primary_poe_present: { name: 'Primary PoE present' },
		secondary_poe_present: { name: 'Secondary PoE present' },
	}

	for (let input = 1; input <= 8; input++) {
		definitions[`input${input}_dante_label`] = { name: `Input ${input} Dante label` }
		definitions[`input${input}_friendly_name`] = { name: `Input ${input} friendly name` }
		definitions[`input${input}_mode`] = { name: `Input ${input} mode` }
		definitions[`input${input}_phantom_power`] = { name: `Input ${input} phantom power enabled` }
		definitions[`input${input}_preamp_gain`] = { name: `Input ${input} preamp gain (dB)` }
		definitions[`input${input}_full_scale_level`] = { name: `Input ${input} full scale level` }
		definitions[`input${input}_hpf_enabled`] = { name: `Input ${input} high-pass filter enabled` }
		definitions[`input${input}_hpf_frequency`] = { name: `Input ${input} high-pass filter frequency (Hz)` }
		definitions[`input${input}_signal_presence_timeout`] = { name: `Input ${input} signal-presence timeout (seconds)` }
		definitions[`input${input}_signal_presence_threshold`] = { name: `Input ${input} signal-presence threshold (dBFS)` }
		definitions[`input${input}_mute`] = { name: `Input ${input} software mute active` }
		definitions[`input${input}_gpi_mute`] = { name: `Input ${input} GPI mute active` }
		definitions[`input${input}_mute_active`] = { name: `Input ${input} overall mute active (software or GPI)` }
		definitions[`input${input}_meter`] = { name: `Input ${input} meter segments` }
	}

	self.setVariableDefinitions(definitions)
}

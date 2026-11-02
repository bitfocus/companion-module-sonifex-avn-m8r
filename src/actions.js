const WebSocket = require('ws')
const { isAsserted, inputOption, toInputIndex, FULL_SCALE_DBU, fullScaleLabel } = require('./util')

const STATE_EXPRESSION = "'on', 'off' or 'toggle'"

const stateOption = (label, onLabel = 'On', offLabel = 'Off', defaultState = 'off') => ({
	id: 'state',
	type: 'dropdown',
	label,
	default: defaultState,
	choices: [
		{ id: 'off', label: offLabel },
		{ id: 'on', label: onLabel },
		{ id: 'toggle', label: 'Toggle' },
	],
	expressionDescription: STATE_EXPRESSION,
})

const PREAMP_GAIN_DB_MIN = 16
const PREAMP_GAIN_DB_MAX = 76
const PREAMP_GAIN_STEP = 3
const PREAMP_GAINS = Array.from(
	{ length: (PREAMP_GAIN_DB_MAX - PREAMP_GAIN_DB_MIN) / PREAMP_GAIN_STEP + 1 },
	(_, index) => PREAMP_GAIN_DB_MIN + index * PREAMP_GAIN_STEP,
)

// Ember+ line_mic values.
const INPUT_MODES = { mic: 0, line: 1 }

const setInputParameter = async (self, input, key, value, signal) => {
	try {
		await self.ember.setInputParameter(input, key, value, signal)
	} catch (error) {
		if (signal?.aborted) return
		self.log('error', `Action failed: ${error.message}`)
	}
}

const setStatusLeds = (self, value) => {
	if (!self.audioWs || self.audioWs.readyState !== WebSocket.OPEN) {
		self.log('error', 'Action failed: WebSocket is not connected')
		return
	}

	self.audioWs.send(JSON.stringify({ audio: { statusLeds: Number(value) } }), (error) => {
		if (error) self.log('error', `Action failed: ${error.message}`)
	})
}

// Resolves 'on', 'off' or 'toggle' against the current device state. Returns a boolean, or null if it can't.
const resolveBinaryState = (self, requestedState, currentState, settingName) => {
	if (requestedState === 'on') return true
	if (requestedState === 'off') return false
	if (requestedState !== 'toggle') {
		self.log(
			'error',
			`Cannot set ${settingName}: unknown state ${JSON.stringify(requestedState)}, expected ${STATE_EXPRESSION}`,
		)
		return null
	}

	if (currentState === undefined || currentState === null) {
		self.log('error', `Cannot toggle ${settingName}: current device state has not been received`)
		return null
	}

	return !isAsserted(currentState)
}

const adjustPreampGain = async (self, input, adjustment, signal) => {
	const currentGain = Number(self.inputState?.[input]?.preamp_gain)
	if (!Number.isFinite(currentGain)) {
		self.log('error', 'Cannot adjust preamp gain: current Ember+ value has not been received')
		return
	}

	const newGain = Math.min(PREAMP_GAIN_DB_MAX, Math.max(PREAMP_GAIN_DB_MIN, currentGain + adjustment))
	if (newGain !== currentGain) await setInputParameter(self, input, 'preamp_gain', newGain, signal)
}

module.exports = function (self) {
	self.setActionDefinitions({
		line_mic: {
			name: 'Set Input Mode',
			options: [
				inputOption(),
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'mic',
					choices: [
						{ id: 'mic', label: 'Mic' },
						{ id: 'line', label: 'Line' },
						{ id: 'toggle', label: 'Toggle' },
					],
					expressionDescription: "'mic', 'line' or 'toggle'",
				},
			],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				let mode = INPUT_MODES[event.options.mode]
				if (event.options.mode === 'toggle') {
					const line = resolveBinaryState(self, 'toggle', self.inputState?.[input]?.line_mic, 'input mode')
					if (line === null) return
					mode = line ? INPUT_MODES.line : INPUT_MODES.mic
				}
				if (mode === undefined) {
					self.log('error', `Cannot set input mode: unknown mode ${JSON.stringify(event.options.mode)}`)
					return
				}
				await setInputParameter(self, input, 'line_mic', mode, context.signal)
			},
		},
		phantom_power: {
			name: 'Set Phantom Power',
			options: [inputOption(), stateOption('Phantom Power')],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				const state = resolveBinaryState(
					self,
					event.options.state,
					self.inputState?.[input]?.phantom_power,
					'phantom power',
				)
				if (state !== null) await setInputParameter(self, input, 'phantom_power', state, context.signal)
			},
		},
		set_preamp_gain: {
			name: 'Set Preamp Gain',
			options: [
				inputOption(),
				{
					id: 'gain',
					type: 'dropdown',
					label: 'Gain',
					default: PREAMP_GAIN_DB_MIN,
					choices: PREAMP_GAINS.map((gain) => ({ id: gain, label: `${gain} dB` })),
					expressionDescription: `Gain in dB: ${PREAMP_GAIN_DB_MIN} to ${PREAMP_GAIN_DB_MAX} in steps of ${PREAMP_GAIN_STEP}`,
				},
			],
			callback: async (event, context) => {
				const gain = Number(event.options.gain)
				if (!PREAMP_GAINS.includes(gain)) {
					self.log('error', `Cannot set preamp gain: unsupported gain ${JSON.stringify(event.options.gain)}`)
					return
				}
				const input = toInputIndex(event.options.input)
				await setInputParameter(self, input, 'preamp_gain', gain, context.signal)
			},
		},
		adjust_preamp_gain: {
			name: 'Adjust Preamp Gain',
			options: [
				inputOption(),
				{
					id: 'operation',
					type: 'dropdown',
					label: 'Operation',
					default: 'increase',
					choices: [
						{ id: 'increase', label: 'Increase' },
						{ id: 'decrease', label: 'Decrease' },
					],
				},
				{
					id: 'step',
					type: 'dropdown',
					label: 'Gain Step',
					default: 1,
					choices: [1, 2, 4, 5, 10].map((factor) => ({ id: factor, label: `${factor * 3} dB` })),
					tooltip: 'Select the gain change applied per adjustment.',
				},
			],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				const steps = Math.max(1, Math.round(Number(event.options.step) || 1))
				switch (event.options.operation) {
					case 'increase':
						await adjustPreampGain(self, input, steps * PREAMP_GAIN_STEP, context.signal)
						break
					case 'decrease':
						await adjustPreampGain(self, input, -steps * PREAMP_GAIN_STEP, context.signal)
						break
					default:
						self.log('error', `Cannot adjust preamp gain: unknown operation ${JSON.stringify(event.options.operation)}`)
				}
			},
		},
		full_scale_level: {
			name: 'Set Full Scale Level',
			options: [
				inputOption(),
				{
					id: 'level',
					type: 'dropdown',
					label: 'Full Scale Level',
					default: FULL_SCALE_DBU[0],
					choices: FULL_SCALE_DBU.map((dbu) => ({ id: dbu, label: fullScaleLabel(dbu) })),
					expressionDescription: `Level in dBu: ${FULL_SCALE_DBU.join(', ')}`,
				},
			],
			callback: async (event, context) => {
				const level = FULL_SCALE_DBU.indexOf(Number(event.options.level))
				if (level === -1) {
					self.log('error', `Cannot set full scale level: unsupported level ${JSON.stringify(event.options.level)}`)
					return
				}
				const input = toInputIndex(event.options.input)
				await setInputParameter(self, input, 'full_scale_level', level, context.signal)
			},
		},
		hpf_enable: {
			name: 'Set High-Pass Filter State',
			options: [inputOption(), stateOption('High-Pass Filter')],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				const state = resolveBinaryState(
					self,
					event.options.state,
					self.inputState?.[input]?.hpf_enable,
					'high-pass filter',
				)
				if (state !== null) await setInputParameter(self, input, 'hpf_enable', state, context.signal)
			},
		},
		hpf_freq: {
			name: 'Set High-Pass Filter Frequency',
			options: [
				inputOption(),
				{
					id: 'frequency',
					type: 'number',
					label: 'Corner Frequency (Hz)',
					default: 125,
					min: 40,
					max: 3000,
					step: 5,
				},
			],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				await setInputParameter(self, input, 'hpf_freq', Number(event.options.frequency), context.signal)
			},
		},
		sig_pres_timeout: {
			name: 'Set Signal-Presence Timeout',
			options: [
				inputOption(),
				{
					id: 'timeout',
					type: 'number',
					label: 'Timeout (seconds)',
					default: 5,
					min: 0,
					max: 300,
				},
			],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				await setInputParameter(self, input, 'sig_pres_timeout', Number(event.options.timeout), context.signal)
			},
		},
		sig_pres_threshold: {
			name: 'Set Signal-Presence Threshold',
			options: [
				inputOption(),
				{
					id: 'threshold',
					type: 'number',
					label: 'Threshold (dBFS)',
					default: -40,
					min: -70,
					max: 0,
				},
			],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				await setInputParameter(self, input, 'sig_pres_threshold', Number(event.options.threshold), context.signal)
			},
		},
		mute: {
			name: 'Set Input Mute',
			options: [inputOption(), stateOption('Mute', 'Muted', 'Unmuted')],
			callback: async (event, context) => {
				const input = toInputIndex(event.options.input)
				const state = resolveBinaryState(self, event.options.state, self.inputState?.[input]?.mute, 'input mute')
				if (state !== null) await setInputParameter(self, input, 'mute', state, context.signal)
			},
		},
		status_leds: {
			name: 'Set Status LEDs',
			options: [stateOption('Status LEDs', 'Enabled', 'Disabled', 'on')],
			callback: async (event) => {
				const state = resolveBinaryState(self, event.options.state, self.statusLeds, 'status LEDs')
				if (state !== null) setStatusLeds(self, state ? 1 : 0)
			},
		},
	})
}

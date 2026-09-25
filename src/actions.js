const WebSocket = require('ws')

const inputChoices = [
	{ id: 0, label: 'Input 1' },
	{ id: 1, label: 'Input 2' },
	{ id: 2, label: 'Input 3' },
	{ id: 3, label: 'Input 4' },
	{ id: 4, label: 'Input 5' },
	{ id: 5, label: 'Input 6' },
	{ id: 6, label: 'Input 7' },
	{ id: 7, label: 'Input 8' },
]

const onOffChoices = [
	{ id: 0, label: 'Off' },
	{ id: 1, label: 'On' },
	{ id: 2, label: 'Toggle' },
]

const PREAMP_GAIN_DB_MIN = 16
const PREAMP_GAIN_DB_MAX = 76
const PREAMP_GAIN_STEP = 3

const inputOption = () => ({
	id: 'input',
	type: 'dropdown',
	label: 'Input',
	default: 0,
	choices: inputChoices,
})

const setInputParameter = async (self, input, key, value) => {
	try {
		await self.ember.setInputParameter(Number(input), key, value)
	} catch (error) {
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

const resolveBinaryState = (self, requestedState, currentState, settingName) => {
	const state = Number(requestedState)
	if (state !== 2) return state

	if (currentState === undefined || currentState === null) {
		self.log('error', `Cannot toggle ${settingName}: current device state has not been received`)
		return null
	}

	return currentState === true || Number(currentState) === 1 ? 0 : 1
}

const adjustPreampGain = async (self, input, adjustment) => {
	const currentGain = Number(self.inputState?.[input]?.preamp_gain)
	if (!Number.isFinite(currentGain)) {
		self.log('error', 'Cannot adjust preamp gain: current Ember+ value has not been received')
		return
	}

	const newGain = Math.min(PREAMP_GAIN_DB_MAX, Math.max(PREAMP_GAIN_DB_MIN, currentGain + adjustment))
	if (newGain !== currentGain) await setInputParameter(self, input, 'preamp_gain', newGain)
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
					default: 0,
					choices: [
						{ id: 0, label: 'Mic' },
						{ id: 1, label: 'Line' },
					],
				},
			],
			callback: async (event) => {
				await setInputParameter(self, event.options.input, 'line_mic', Number(event.options.mode))
			},
		},
		phantom_power: {
			name: 'Set Phantom Power',
			options: [
				inputOption(),
				{
					id: 'state',
					type: 'dropdown',
					label: 'Phantom Power',
					default: 0,
					choices: onOffChoices,
				},
			],
			callback: async (event) => {
				const input = Number(event.options.input)
				const state = resolveBinaryState(
					self,
					event.options.state,
					self.inputState?.[input]?.phantom_power,
					'phantom power',
				)
				if (state !== null) await setInputParameter(self, input, 'phantom_power', state === 1)
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
					default: 16,
					choices: Array.from({ length: 21 }, (_, index) => {
						const gain = 16 + index * 3
						return { id: gain, label: `${gain} dB` }
					}),
				},
			],
			callback: async (event) => {
				const input = Number(event.options.input)
				await setInputParameter(self, input, 'preamp_gain', Number(event.options.gain))
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
					isVisibleExpression: `$(options:operation) === 'increase' || $(options:operation) === 'decrease'`,
					choices: [1, 2, 4, 5, 10].map((factor) => ({ id: factor, label: `${factor * 3} dB` })),
					tooltip: 'Select the gain change applied per adjustment.',
				},
			],
			callback: async (event) => {
				const input = Number(event.options.input)
				const steps = Math.max(1, Math.round(Number(event.options.step) || 1))
				switch (event.options.operation || 'set') {
					case 'increase':
						await adjustPreampGain(self, input, steps * PREAMP_GAIN_STEP)
						break
					case 'decrease':
						await adjustPreampGain(self, input, -steps * PREAMP_GAIN_STEP)
						break
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
					default: 0,
					choices: [
						{ id: 0, label: '+15 dBu' },
						{ id: 1, label: '+18 dBu' },
						{ id: 2, label: '+20 dBu' },
						{ id: 3, label: '+22 dBu' },
						{ id: 4, label: '+24 dBu' },
					],
				},
			],
			callback: async (event) => {
				await setInputParameter(self, event.options.input, 'full_scale_level', Number(event.options.level))
			},
		},
		hpf_enable: {
			name: 'Set High-Pass Filter State',
			options: [
				inputOption(),
				{
					id: 'state',
					type: 'dropdown',
					label: 'High-Pass Filter',
					default: 0,
					choices: onOffChoices,
				},
			],
			callback: async (event) => {
				const input = Number(event.options.input)
				const state = resolveBinaryState(
					self,
					event.options.state,
					self.inputState?.[input]?.hpf_enable,
					'high-pass filter',
				)
				if (state !== null) await setInputParameter(self, input, 'hpf_enable', state === 1)
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
			callback: async (event) => {
				await setInputParameter(self, event.options.input, 'hpf_freq', Number(event.options.frequency))
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
			callback: async (event) => {
				await setInputParameter(self, event.options.input, 'sig_pres_timeout', Number(event.options.timeout))
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
			callback: async (event) => {
				await setInputParameter(self, event.options.input, 'sig_pres_threshold', Number(event.options.threshold))
			},
		},
		mute: {
			name: 'Set Input Mute',
			options: [
				inputOption(),
				{
					id: 'state',
					type: 'dropdown',
					label: 'Mute',
					default: 0,
					choices: [
						{ id: 0, label: 'Unmuted' },
						{ id: 1, label: 'Muted' },
						{ id: 2, label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const input = Number(event.options.input)
				const state = resolveBinaryState(self, event.options.state, self.inputState?.[input]?.mute, 'input mute')
				if (state !== null) await setInputParameter(self, input, 'mute', state === 1)
			},
		},
		status_leds: {
			name: 'Set Status LEDs',
			options: [
				{
					id: 'state',
					type: 'dropdown',
					label: 'Status LEDs',
					default: 1,
					choices: [
						{ id: 0, label: 'Disabled' },
						{ id: 1, label: 'Enabled' },
						{ id: 2, label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const state = resolveBinaryState(self, event.options.state, self.statusLeds, 'status LEDs')
				if (state !== null) setStatusLeds(self, state)
			},
		},
	})
}

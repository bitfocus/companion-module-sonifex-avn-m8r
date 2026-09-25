const { isAsserted, isMuted } = require('./util')

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

// AVN-M8R Ember+ input parameters
const parameterChoices = [
	{ id: 'line_mic', label: 'Signal Level (0 = Mic, 1 = Line)' },
	{ id: 'phantom_power', label: 'Phantom Power' },
	{ id: 'preamp_gain', label: 'Preamp Gain' },
	{ id: 'full_scale_level', label: 'Full Scale Level' },
	{ id: 'hpf_enable', label: 'High-Pass Filter' },
	{ id: 'hpf_freq', label: 'High-Pass Filter Frequency' },
	{ id: 'sig_pres_timeout', label: 'Signal-Presence Timeout' },
	{ id: 'sig_pres_threshold', label: 'Signal-Presence Threshold' },
	{ id: 'mute', label: 'Mute' },
]

const comparable = (value) => String(typeof value === 'boolean' ? Number(value) : (value ?? ''))

// Lower dBFS bound of each meter segment.
const METER_SEGMENT_DBFS = [
	null,
	-52,
	-47.33,
	-42.66,
	-38,
	-33.33,
	-28.66,
	-24,
	-22.5,
	-21,
	-19.5,
	-18,
	-16.5,
	-15,
	-13.5,
	-12,
	-10,
	-8,
	-6,
	-4,
	-2,
	-0.1,
]

const meterChoices = METER_SEGMENT_DBFS.map((dbfs, segments) => ({
	id: segments,
	label: segments === 0 ? 'Silence (below -52 dBFS)' : `${dbfs} dBFS`,
}))

module.exports = function (self) {
	self.setFeedbackDefinitions({
		ParameterState: {
			name: 'Ember+ Parameter',
			description: 'Active when the selected Ember+ input parameter matches the specified value.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00ff00,
				color: 0x000000,
			},
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Input',
					default: 0,
					choices: inputChoices,
				},
				{
					id: 'parameter',
					type: 'dropdown',
					label: 'Parameter',
					default: 'line_mic',
					choices: parameterChoices,
				},
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '1',
				},
			],
			callback: (feedback) => {
				const value = self.inputState?.[Number(feedback.options.input)]?.[feedback.options.parameter]
				return value !== undefined && comparable(value) === comparable(feedback.options.value)
			},
			learn: (feedback) => {
				const value = self.inputState?.[Number(feedback.options.input)]?.[feedback.options.parameter]
				return value === undefined ? undefined : { value: comparable(value) }
			},
		},
		MuteState: {
			name: 'Input Mute',
			description: 'Active when the selected input matches the mute state.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff0000,
				color: 0xffffff,
			},
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Input',
					default: 0,
					choices: inputChoices,
				},
				{
					id: 'source',
					type: 'dropdown',
					label: 'Source',
					default: 'any',
					choices: [
						{ id: 'any', label: 'Software or GPI' },
						{ id: 'software', label: 'Software only' },
						{ id: 'gpi', label: 'GPI only' },
					],
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 1,
					choices: [
						{ id: 1, label: 'Muted' },
						{ id: 0, label: 'Unmuted' },
					],
				},
			],
			callback: (feedback) => {
				const state = self.inputState?.[Number(feedback.options.input)]
				const source = feedback.options.source

				const value =
					source === 'software' ? state?.mute : source === 'gpi' ? state?.gpi_mute : (state?.mute ?? state?.gpi_mute)
				if (value === undefined) return false

				const muted = source === 'any' ? isMuted(state) : isAsserted(value)
				return muted === (Number(feedback.options.state) === 1)
			},
		},
		MeterLevel: {
			name: 'Input Meter Level',
			description: 'Active when the selected input meter compares as chosen against the level.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00ff00,
				color: 0x000000,
			},
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Input',
					default: 0,
					choices: inputChoices,
				},
				{
					id: 'comparison',
					type: 'dropdown',
					label: 'Comparison',
					default: '>',
					choices: [
						{ id: '<', label: '<' },
						{ id: '=', label: '=' },
						{ id: '>', label: '>' },
					],
				},
				{
					id: 'threshold',
					type: 'dropdown',
					label: 'Level (dBFS)',
					default: 0,
					choices: meterChoices,
				},
			],
			callback: (feedback) => {
				const segments = self.meters?.[Number(feedback.options.input)]
				if (segments === undefined) return false

				const threshold = Number(feedback.options.threshold)
				if (feedback.options.comparison === '<') return segments < threshold
				if (feedback.options.comparison === '=') return segments === threshold
				return segments > threshold
			},
		},
		PowerInput: {
			name: 'PoE Input',
			description: 'Active when the selected PoE input matches the state.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff0000,
				color: 0xffffff,
			},
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'PoE Input',
					default: 1,
					choices: [
						{ id: 1, label: 'Primary' },
						{ id: 2, label: 'Secondary' },
					],
				},
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 0,
					choices: [
						{ id: 0, label: 'Not present' },
						{ id: 1, label: 'Present' },
					],
				},
			],
			callback: (feedback) => {
				const present = self.powerInputs?.[Number(feedback.options.input)]
				if (present === undefined) return false
				return present === (Number(feedback.options.state) === 1)
			},
		},
		StatusLeds: {
			name: 'Status LEDs',
			description: 'Active when the WebSocket-reported status LED setting matches the selected state.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00ff00,
				color: 0x000000,
			},
			options: [
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 1,
					choices: [
						{ id: 0, label: 'Disabled' },
						{ id: 1, label: 'Enabled' },
					],
				},
			],
			callback: (feedback) => {
				return self.statusLeds !== undefined && comparable(self.statusLeds) === comparable(feedback.options.state)
			},
		},
	})
}

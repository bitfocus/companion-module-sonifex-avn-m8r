const { isAsserted, isMuted, inputOption, toInputIndex, FULL_SCALE_DBU } = require('./util')
const { formatParameter } = require('./ember')

// AVN-M8R Ember+ input parameters
const parameterChoices = [
	{ id: 'line_mic', label: 'Signal Level (0 = Mic, 1 = Line)' },
	{ id: 'phantom_power', label: 'Phantom Power' },
	{ id: 'preamp_gain', label: 'Preamp Gain' },
	{ id: 'full_scale_level', label: 'Full Scale Level (dBu)' },
	{ id: 'hpf_enable', label: 'High-Pass Filter' },
	{ id: 'hpf_freq', label: 'High-Pass Filter Frequency' },
	{ id: 'sig_pres_timeout', label: 'Signal-Presence Timeout' },
	{ id: 'sig_pres_threshold', label: 'Signal-Presence Threshold' },
	{ id: 'mute', label: 'Mute' },
]

const comparable = (value) => String(typeof value === 'boolean' ? Number(value) : (value ?? ''))

// Values a parameter matches: raw Ember+ value, variable text and, for full scale level, the dBu number.
const matchCandidates = (parameter, value) => {
	const candidates = [value, formatParameter(parameter, value)]
	if (parameter === 'full_scale_level') candidates.push(FULL_SCALE_DBU[Number(value)])
	return candidates.filter((candidate) => candidate !== undefined)
}

// Case-insensitive text match, or numeric match so '+18' equals 18.
const matches = (candidate, expected) => {
	const text = comparable(candidate).toLowerCase()
	if (text === expected) return true
	return expected !== '' && text !== '' && Number.isFinite(Number(expected)) && Number(text) === Number(expected)
}

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

// Choice id for the silence band; any level below the lowest band would do.
const METER_SILENCE_DBFS = -60

const meterChoices = METER_SEGMENT_DBFS.map((dbfs, segments) =>
	segments === 0 ? { id: METER_SILENCE_DBFS, label: 'Silence (below -52 dBFS)' } : { id: dbfs, label: `${dbfs} dBFS` },
)

// Meter segment whose band contains a dBFS level, 0 for anything below the lowest band.
const dbfsToSegment = (dbfs) => {
	let segment = 0
	for (let index = 1; index < METER_SEGMENT_DBFS.length; index++) {
		if (dbfs >= METER_SEGMENT_DBFS[index]) segment = index
	}
	return segment
}

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
				inputOption(),

				{
					id: 'parameter',
					type: 'dropdown',
					label: 'Parameter',
					default: 'line_mic',
					choices: parameterChoices,
					expressionDescription: `Parameter id: ${parameterChoices.map(({ id }) => `'${id}'`).join(', ')}`,
				},
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '1',
					tooltip: 'The raw Ember+ value, or the text the matching variable shows (e.g. Line, +18 dBu).',
					expressionDescription: "The value to compare, e.g. 1 or '+18 dBu'",
				},
			],
			callback: (feedback) => {
				const parameter = feedback.options.parameter
				const value = self.inputState?.[toInputIndex(feedback.options.input)]?.[parameter]
				if (value === undefined) return false

				const expected = comparable(feedback.options.value).trim().toLowerCase()
				return matchCandidates(parameter, value).some((candidate) => matches(candidate, expected))
			},
			learn: (feedback) => {
				const parameter = feedback.options.parameter
				const value = self.inputState?.[toInputIndex(feedback.options.input)]?.[parameter]
				return value === undefined ? undefined : { value: comparable(formatParameter(parameter, value)) }
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
				inputOption(),

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
					expressionDescription: "'any', 'software' or 'gpi'",
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
					expressionDescription: '1 for Muted, 0 for Unmuted',
				},
			],
			callback: (feedback) => {
				const state = self.inputState?.[toInputIndex(feedback.options.input)]
				const source = feedback.options.source
				if (!['any', 'software', 'gpi'].includes(source)) return false

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
				inputOption(),

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
					expressionDescription: "'<', '=' or '>'",
				},
				{
					id: 'threshold',
					type: 'dropdown',
					label: 'Level (dBFS)',
					default: METER_SILENCE_DBFS,
					choices: meterChoices,
					expressionDescription: 'Level in dBFS. e.g. -18.',
				},
			],
			callback: (feedback) => {
				const segments = self.meters?.[toInputIndex(feedback.options.input)]
				if (segments === undefined) return false

				const level = Number(feedback.options.threshold)
				if (!Number.isFinite(level)) return false
				const threshold = dbfsToSegment(level)
				if (feedback.options.comparison === '<') return segments < threshold
				if (feedback.options.comparison === '=') return segments === threshold
				if (feedback.options.comparison === '>') return segments > threshold
				return false
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
					expressionDescription: '1 for Primary, 2 for Secondary',
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
					expressionDescription: '1 for Present, 0 for Not present',
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
			description: 'Active when the status LED setting matches the selected state.',
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
					expressionDescription: '1 for Enabled, 0 for Disabled',
				},
			],
			callback: (feedback) => {
				return self.statusLeds !== undefined && comparable(self.statusLeds) === comparable(feedback.options.state)
			},
		},
	})
}

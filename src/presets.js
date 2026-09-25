const { combineRgb } = require('@companion-module/base')

const BLACK = combineRgb(0, 0, 0)
const WHITE = combineRgb(255, 255, 255)
const RED = combineRgb(200, 0, 0)
const GREEN = combineRgb(0, 160, 0)
const AMBER = combineRgb(200, 130, 0)
const BLUE = combineRgb(0, 80, 160)

const VAR = 'sonifex-avn-m8r'
const INPUTS = [1, 2, 3, 4, 5, 6, 7, 8]

const lines = (...rows) => rows.join('\n')
const baseStyle = (text, bgcolor = BLACK) => ({ text, size: 'auto', color: WHITE, bgcolor })

// Button with no actions.
const lamp = (name, style, feedbacks, keywords) => ({
	type: 'simple',
	name,
	keywords,
	style,
	steps: [{ down: [], up: [] }],
	feedbacks,
})

const pressButton = (name, style, actions, feedbacks, keywords) => ({
	type: 'simple',
	name,
	keywords,
	style,
	steps: [{ down: actions, up: [] }],
	feedbacks,
})

module.exports = function (self) {
	const presets = {}

	for (const input of INPUTS) {
		const index = input - 1
		const label = `IN ${input}`

		presets[`mute_${input}`] = pressButton(
			`Input ${input} mute toggle`,
			baseStyle(lines(label, `$(${VAR}:input${input}_mute_active)`)),
			[{ actionId: 'mute', options: { input: index, state: 2 } }],
			[
				{
					feedbackId: 'MuteState',
					options: { input: index, source: 'any', state: 1 },
					style: { bgcolor: RED, color: WHITE },
					headline: 'Red while muted by either source',
				},
				{
					feedbackId: 'MuteState',
					options: { input: index, source: 'gpi', state: 1 },
					style: { bgcolor: AMBER, color: BLACK },
					headline: 'Amber when the GPI is holding the mute.',
				},
			],
			['mute', 'gpi'],
		)

		presets[`phantom_${input}`] = pressButton(
			`Input ${input} phantom power toggle`,
			baseStyle(lines(label, '48V')),
			[{ actionId: 'phantom_power', options: { input: index, state: 2 } }],
			[
				{
					feedbackId: 'ParameterState',
					options: { input: index, parameter: 'phantom_power', value: '1' },
					style: { bgcolor: RED, color: WHITE },
				},
			],
			['phantom', '48v'],
		)

		presets[`mode_${input}`] = {
			type: 'simple',
			name: `Input ${input} mic/line mode`,
			keywords: ['mic', 'line'],
			style: baseStyle(lines(label, `$(${VAR}:input${input}_mode)`)),
			steps: [
				{ name: 'Set Line', down: [{ actionId: 'line_mic', options: { input: index, mode: 1 } }], up: [] },
				{ name: 'Set Mic', down: [{ actionId: 'line_mic', options: { input: index, mode: 0 } }], up: [] },
			],
			feedbacks: [
				{
					feedbackId: 'ParameterState',
					options: { input: index, parameter: 'line_mic', value: '1' },
					style: { bgcolor: BLUE, color: WHITE },
					headline: 'Blue in line mode',
				},
			],
		}

		presets[`meter_${input}`] = {
			type: 'layered',
			name: `Input ${input} meter gauge`,
			keywords: ['meter', 'gauge', 'level'],
			elements: [
				{ type: 'box', x: 0, y: 0, width: 100, height: 100, color: BLACK },
				{
					type: 'text',
					text: String(input),
					x: 4,
					y: 4,
					width: 22,
					height: 24,
					fontsize: 80,
					color: WHITE,
					halign: 'left',
					valign: 'top',
				},
				{
					type: 'gauge',
					x: 30,
					y: 0,
					width: 40,
					height: 100,
					value: { isExpression: true, value: `$(${VAR}:input${input}_meter)` },
					min: 0,
					max: 21,
					origin: 0,
					orientation: 'vertical',
					fillEnabled: true,
					multiColour: true,
					fillWidth: 100,
					trackStyle: 'dimmed',
					trackAmount: 20,
					trackWidth: 100,
					stops: [
						{ value: 0, color: GREEN, gradient: true },
						{ value: 11, color: AMBER, gradient: true },
						{ value: 18, color: RED, gradient: true },
					],
				},
			],
			steps: [{ down: [], up: [] }],
			feedbacks: [],
		}

		presets[`signal_${input}`] = lamp(
			`Input ${input} signal present`,
			baseStyle(lines(label, 'SIG')),
			[
				{
					feedbackId: 'MeterLevel',
					options: { input: index, comparison: '>', threshold: 0 },
					style: { bgcolor: GREEN, color: WHITE },
				},
			],
			['signal', 'meter'],
		)

		presets[`clip_${input}`] = lamp(
			`Input ${input} clip`,
			baseStyle(lines(label, 'CLIP')),
			[
				{
					feedbackId: 'MeterLevel',
					options: { input: index, comparison: '=', threshold: 21 },
					style: { bgcolor: RED, color: WHITE },
				},
			],
			['clip', 'meter', 'peak'],
		)
	}

	presets.status_leds = pressButton(
		'Status LEDs toggle',
		baseStyle(lines('STATUS', 'LEDS')),
		[{ actionId: 'status_leds', options: { state: 2 } }],
		[{ feedbackId: 'StatusLeds', options: { state: 1 }, style: { bgcolor: GREEN, color: WHITE } }],
		['leds'],
	)

	for (const [id, index, name, short] of [
		['poe_primary', 1, 'Primary', 'PRI'],
		['poe_secondary', 2, 'Secondary', 'SEC'],
	]) {
		presets[id] = lamp(
			`${name} PoE fail`,
			baseStyle(lines(short, 'PoE')),
			[
				{
					feedbackId: 'PowerInput',
					options: { input: index, state: 0 },
					style: { bgcolor: RED, color: WHITE },
				},
			],
			['poe', 'power'],
		)
	}

	presets.temperature = lamp(
		'Device temperature',
		baseStyle(lines('TEMP', `$(${VAR}:device_temperature) C`)),
		[],
		['temp'],
	)

	presets.uptime = lamp('Device uptime', baseStyle(lines('UPTIME', `$(${VAR}:device_uptime)`)), [], ['uptime'])

	const group = (id, name, presetIds, description) => ({ id, type: 'simple', name, description, presets: presetIds })
	const perInput = (prefix) => INPUTS.map((input) => `${prefix}_${input}`)

	const structure = [
		{
			id: 'inputs',
			name: 'Inputs',
			description: 'One button per mic/line input.',
			definitions: [
				group('mute', 'Mute', perInput('mute'), 'Toggles the software mute; turns amber when a GPI is muting.'),
				group('phantom', 'Phantom Power', perInput('phantom')),
				group('mode', 'Mic/Line Mode', perInput('mode')),
			],
		},
		{
			id: 'metering',
			name: 'Metering',
			definitions: [
				group('meter', 'Meter Gauges', perInput('meter')),
				group('signal', 'Signal Present', perInput('signal')),
				group('clip', 'Clip', perInput('clip')),
			],
		},
		{
			id: 'device',
			name: 'Device',
			definitions: ['status_leds', 'poe_primary', 'poe_secondary', 'temperature', 'uptime'],
		},
	]

	self.setPresetDefinitions(structure, presets)
}

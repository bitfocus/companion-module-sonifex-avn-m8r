const isAsserted = (value) => value === true || Number(value) === 1
const isMuted = (state) => isAsserted(state?.mute) || isAsserted(state?.gpi_mute)
const parsePowerPresence = (value) => {
	const text = String(value).trim().toLowerCase()
	if (text === 'present') return true
	if (text === 'not present') return false
	return undefined
}

const INPUT_COUNT = 8
const inputChoices = Array.from({ length: INPUT_COUNT }, (_, index) => ({ id: index + 1, label: `Input ${index + 1}` }))
const inputOption = () => ({
	id: 'input',
	type: 'dropdown',
	label: 'Input',
	default: 1,
	choices: inputChoices,
	expressionDescription: `Input number, 1 to ${INPUT_COUNT}`,
})

// Input option value (1-8) to zero-based index.
const toInputIndex = (value) => Number(value) - 1
const FULL_SCALE_DBU = [15, 18, 20, 22, 24]
const fullScaleLabel = (dbu) => `+${dbu} dBu`

module.exports = {
	isAsserted,
	isMuted,
	parsePowerPresence,
	inputOption,
	toInputIndex,
	FULL_SCALE_DBU,
	fullScaleLabel,
}

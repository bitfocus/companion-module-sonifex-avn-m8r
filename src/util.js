const isAsserted = (value) => value === true || Number(value) === 1
const isMuted = (state) => isAsserted(state?.mute) || isAsserted(state?.gpi_mute)
const parsePowerPresence = (value) => {
	const text = String(value).trim().toLowerCase()
	if (text === 'present') return true
	if (text === 'not present') return false
	return undefined
}

module.exports = { isAsserted, isMuted, parsePowerPresence }

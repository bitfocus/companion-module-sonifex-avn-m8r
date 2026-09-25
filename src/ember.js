const { EmberClient, Model } = require('emberplus-connection')

const text = (node) => {
	const contents = node?.contents || node
	return `${contents?.identifier || ''} ${contents?.description || ''}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

const parameterKey = (node) => {
	const name = text(node)

	if (name.includes('gpi mute')) return null
	if (name.includes('signal presence') && name.includes('timeout')) return 'sig_pres_timeout'
	if (name.includes('signal presence') && name.includes('threshold')) return 'sig_pres_threshold'
	if ((name.includes('high pass') || name.includes('hpf')) && (name.includes('frequ') || name.includes('corner')))
		return 'hpf_freq'
	if (name.includes('high pass') || name.includes('hpf')) return 'hpf_enable'
	if (name.includes('phantom')) return 'phantom_power'
	if (name.includes('preamp gain') || name.includes('mic gain')) return 'preamp_gain'
	if (name.includes('full scale') || name.includes('lineup') || name.includes('fsd')) return 'full_scale_level'
	if (name.includes('line mic') || name.includes('input level') || name.includes('signal level')) return 'line_mic'
	if (name.includes('mute')) return 'mute'
	return null
}

const inputIndex = (node) => {
	const match = text(node).match(/(?:^| )(?:input|channel|ch) 0?([1-8])(?: |$)/)
	return match ? Number(match[1]) - 1 : null
}

const fullScaleLabels = ['+15 dBu', '+18 dBu', '+20 dBu', '+22 dBu', '+24 dBu']

const variableFormatters = {
	line_mic: (value) => (Number(value) === 1 ? 'Line' : 'Mic'),
	full_scale_level: (value) => fullScaleLabels[Number(value)] ?? value,
}

const variableNames = {
	line_mic: 'mode',
	phantom_power: 'phantom_power',
	preamp_gain: 'preamp_gain',
	full_scale_level: 'full_scale_level',
	hpf_enable: 'hpf_enabled',
	hpf_freq: 'hpf_frequency',
	sig_pres_timeout: 'signal_presence_timeout',
	sig_pres_threshold: 'signal_presence_threshold',
	mute: 'mute',
}

class EmberControl {
	constructor(instance) {
		this.instance = instance
		this.client = null
		this.ready = false
		this.inputParameters = Array.from({ length: 8 }, () => ({}))
	}

	async connect(host, port = 9000) {
		await this.disconnect()
		if (!host) return

		const client = new EmberClient(host, port, 10000, true, 1000)
		this.client = client
		client.on('error', (error) => this.instance.log('error', `Ember+ error: ${error.message || error}`))
		client.on('warn', (error) => this.instance.log('warn', `Ember+ warning: ${error.message || error}`))
		client.on('disconnected', () => {
			if (this.client !== client) return
			this.ready = false
			// Rebuild the client, tree and subscriptions through the module's retry loop.
			this.instance.scheduleReconnect('Ember+ connection lost')
		})

		try {
			await client.connect()
			if (this.client !== client) return
			try {
				await client.expand(client.tree)
			} catch (error) {
				this.instance.log('warn', `Ember+ tree expansion warning: ${error.message || error}`)
			}
			if (this.client !== client) return

			const count = this.discoverParameters(client.tree)
			if (count === 0) throw new Error('No Ember+ control parameters were discovered')
			await this.subscribeParameters(client)
			if (this.client !== client) return

			this.ready = true
			this.instance.log('info', `Ember+ controls ready on ${host}:${port} (${count} parameters)`)
		} catch (error) {
			if (this.client === client) {
				this.ready = false
				this.instance.log('error', `Failed to initialise Ember+ controls: ${error.message || error}`)
				this.instance.scheduleReconnect('Ember+ initialisation failed')
			}
		}
	}

	async disconnect() {
		this.ready = false
		const client = this.client
		this.client = null
		if (!client) return

		client.removeAllListeners()
		client.discard()
	}

	discoverParameters(tree) {
		this.inputParameters = Array.from({ length: 8 }, () => ({}))

		const visit = (node, input = null) => {
			if (!node || typeof node !== 'object') return
			if (!node.contents) {
				for (const child of Object.values(node)) visit(child, input)
				return
			}

			const currentInput = inputIndex(node) ?? input
			if (node.contents.type === Model.ElementType.Parameter) {
				const key = parameterKey(node)
				if (key && currentInput !== null) this.inputParameters[currentInput][key] = node
			}

			for (const child of Object.values(node.children || {})) visit(child, currentInput)
		}

		visit(tree)
		return this.inputParameters.reduce((count, parameters) => count + Object.keys(parameters).length, 0)
	}

	async subscribeParameters(client) {
		const responses = []
		const watch = async (node, callback) => {
			callback(node)
			const request = await client.getDirectory(node, undefined, callback)
			if (request.response) responses.push(request.response)
		}

		for (let input = 0; input < this.inputParameters.length; input++) {
			for (const [key, node] of Object.entries(this.inputParameters[input])) {
				await watch(node, (update) => this.updateInputState(input, key, update.contents?.value))
			}
		}
		await Promise.all(responses)
	}

	updateInputState(input, key, value) {
		if (value === undefined) return
		this.instance.inputState[input] = { ...this.instance.inputState[input], [key]: value }

		const variable = variableNames[key]
		if (variable) {
			const format = variableFormatters[key]
			this.instance.setVariableValues({
				[`input${input + 1}_${variable}`]: format ? format(value) : value,
			})
		}

		// 'mute' here is the software half, the GPI half is received over the WebSocket.
		if (key === 'mute') {
			this.instance.setVariableValues(this.instance.muteVariableValues(input))
			this.instance.checkFeedbacks('MuteState')
		}

		this.instance.checkFeedbacks('ParameterState')
	}

	async setInputParameter(input, key, value) {
		const node = this.inputParameters[input]?.[key]
		await this.setParameter(node, value, `'${key}' for input ${input + 1}`)
	}

	async setParameter(node, value, name) {
		if (!this.ready || !this.client) throw new Error('Ember+ controls are not ready')
		if (!node) throw new Error(`Ember+ parameter ${name} was not found`)

		const request = await this.client.setValue(node, value, true)
		if (request.response) await request.response
	}
}

module.exports = { EmberControl }

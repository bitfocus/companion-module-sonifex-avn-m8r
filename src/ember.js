const { EmberClient, Model } = require('emberplus-connection')

// Lowercased identifier and description of a node, with punctuation collapsed to single spaces.
const text = (node) => {
	const contents = node?.contents || node
	return `${contents?.identifier || ''} ${contents?.description || ''}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

// Maps an Ember+ parameter to the module's internal key by name, or null if it isn't one we control.
const parameterKey = (node) => {
	const name = text(node)

	// GPI Mute not exposed on Ember tree.
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

// Zero-based input index named by a node (e.g. 'Input 3', 'ch 03'), or null if it names none.
const inputIndex = (node) => {
	const match = text(node).match(/(?:^| )(?:input|channel|ch) 0?([1-8])(?: |$)/)
	return match ? Number(match[1]) - 1 : null
}

const fullScaleLabels = ['+15 dBu', '+18 dBu', '+20 dBu', '+22 dBu', '+24 dBu']

const variableFormatters = {
	// 1 is Line, anything else is Mic.
	line_mic: (value) => (Number(value) === 1 ? 'Line' : 'Mic'),
	// Enum index to dBu label, falling back to the raw value if out of range.
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
	// Holds the module instance for logging, state and variable updates. No connection is opened here.
	constructor(instance) {
		this.instance = instance
		this.client = null
		this.ready = false
		this.inputParameters = Array.from({ length: 8 }, () => ({}))
	}

	// Replaces any existing client, then connects, expands the tree, discovers and subscribes to input parameters.
	// Any failure hands off to the module's Ember+ reconnect timer, leaving the WebSockets alone.
	async connect(host, port = 9000) {
		await this.disconnect()
		if (!host) return

		const client = new EmberClient(host, port, 10000, true, 1000)
		this.client = client

		// Add three listeners.
		// Errors while not ready end up as the failure reason below, so only log them at debug.
		client.on('error', (error) =>
			this.instance.log(this.ready ? 'error' : 'debug', `Ember+ error: ${error.message || error}`),
		)
		client.on('warn', (error) => this.instance.log('warn', `Ember+ warning: ${error.message || error}`))
		client.on('disconnected', () => {
			// Before ready, a drop rejects the pending requests and is handled by the catch below.
			if (this.client !== client || !this.ready) return
			// Discarding stops the library's own reconnect, so only the module's timer retries.
			void this.disconnect()
			// Rebuild the client, tree and subscriptions on the next retry.
			this.instance.scheduleReconnect('ember', 'connection lost', 'lost')
		})

		try {
			// connect() resolves with an Error on failure rather than rejecting.
			const connectError = await client.connect()
			if (this.client !== client) return
			if (connectError) throw connectError

			let expandError
			try {
				await client.expand(client.tree)
			} catch (error) {
				expandError = error.message || error
			}
			if (this.client !== client) return

			const count = this.discoverParameters(client.tree)
			if (count === 0) {
				const detail = expandError ? `, tree expansion failed: ${expandError}` : ''
				throw new Error(`No Ember+ control parameters were discovered${detail}`)
			}
			// A partial tree is still usable, so only warn.
			if (expandError) this.instance.log('warn', `Ember+ tree expansion warning: ${expandError}`)
			await this.subscribeParameters(client)
			if (this.client !== client) return

			this.ready = true
			this.instance.log('info', `Ember+ controls ready on ${host}:${port} (${count} parameters)`)
			this.instance.transportUp('ember')
		} catch (error) {
			if (this.client === client) {
				void this.disconnect()
				this.instance.scheduleReconnect('ember', `initialisation failed (${error.message || error})`)
			}
		}
	}

	// Detaches listeners and discards the current client so its events can no longer trigger a reconnect.
	async disconnect() {
		this.ready = false
		const client = this.client
		this.client = null
		if (!client) return

		client.removeAllListeners()
		client.discard()
	}

	// Walks the tree and records each recognised parameter node per input. Returns the number found.
	discoverParameters(tree) {
		this.inputParameters = Array.from({ length: 8 }, () => ({}))

		// Recurses through children, inheriting the input index from the nearest ancestor that names one.
		const visit = (node, input = null) => {
			if (!node || typeof node !== 'object') return

			// client.tree only has one top-level element 'root'
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

	// Applies each discovered parameter's current value and subscribes to its changes, waiting for all responses.
	async subscribeParameters(client) {
		const responses = []
		// Applies the node's current value now, then requests it with the same callback for later updates.
		const watch = async (node, callback) => {
			callback(node)
			const request = await client.getDirectory(node, undefined, callback)
			if (request.response) responses.push(request.response)
		}

		// Send GetDirectory for every discovered parameter via watch(). The callback runs
		// once immediately with the value already in the tree, then again whenever the
		// provider reports a change, passing the new value to updateInputState().
		for (let input = 0; input < this.inputParameters.length; input++) {
			for (const [key, node] of Object.entries(this.inputParameters[input])) {
				await watch(node, (update) => this.updateInputState(input, key, update.contents?.value))
			}
		}
		await Promise.all(responses)
	}

	// Stores a parameter value on the input's state, updates its variable and re-checks dependent feedbacks.
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

	// Sets a parameter by input index and internal key.
	async setInputParameter(input, key, value) {
		const node = this.inputParameters[input]?.[key]
		await this.setParameter(node, value, `'${key}' for input ${input + 1}`)
	}

	// Writes a value to a node and waits for the device to confirm it. Throws if Ember+ isn't ready or the node is missing.
	async setParameter(node, value, name) {
		if (!this.ready || !this.client) throw new Error('Ember+ controls are not ready')
		if (!node) throw new Error(`Ember+ parameter ${name} was not found`)

		const request = await this.client.setValue(node, value, true)
		if (request.response) await request.response
	}
}

module.exports = { EmberControl }

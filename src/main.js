const { InstanceBase, Regex, InstanceStatus } = require('@companion-module/base')
const WebSocket = require('ws')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const UpdatePresets = require('./presets')
const { EmberControl } = require('./ember')
const { isAsserted, isMuted, parsePowerPresence } = require('./util')

const WS_PORT = 8081
const WS_MSG_TIMEOUT = 60000
const WS_CONNECT_TIMEOUT = 5000
const EMBER_PORT = 9000
const DEVINFO_CGI_TIMEOUT = 5000
const DEVINFO_POLL_INTERVAL = 30000
const RECONNECT_DELAY = 5000

// Each transport reconnects independently. 'audio' is the primary one and drives the instance status.
const TRANSPORT_LABELS = {
	audio: 'Metering WebSocket',
	devinfo: 'Device info WebSocket',
	ember: 'Ember+',
}

const isDown = (transport) => transport.state === 'failed' || transport.state === 'lost'

class SonifexM8RInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.ember = new EmberControl(this)
		this.reconnectTimers = {}
		this.resetTransports()
	}

	resetState() {
		this.inputState = Array.from({ length: 8 }, () => ({}))
		this.statusLeds = undefined
		this.powerInputs = {}
		this.meters = Array.from({ length: 8 }, () => undefined)
		this.destroyed = false
	}

	async init(config) {
		this.config = config
		this.resetState()

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()
		this.connect()
	}

	async destroy() {
		this.destroyed = true
		this.clearReconnectTimers()
		this.stopDevInfoPolling()
		this.closeWebSockets()
		await this.ember.disconnect()

		this.log('info', 'Module instance destroyed')
	}

	async configUpdated(config) {
		this.config = config
		this.resetState()

		this.connect()
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Device IP',
				width: 8,
				regex: Regex.IP,
				tooltip: 'The IP address of the AVN-M8R.',
			},
		]
	}

	// Full (re)connect of every transport. Only used by init and configUpdated; failures retry per transport.
	connect() {
		if (this.destroyed) return
		this.clearReconnectTimers()
		this.closeWebSockets()
		this.stopDevInfoPolling()
		this.resetTransports()
		this.lastStatus = undefined

		const host = this.config.host
		if (!host) {
			void this.ember.disconnect()
			this.setStatus(InstanceStatus.BadConfig, 'Target IP is not defined')
			return
		}

		this.updateConnectionStatus()
		for (const name of Object.keys(TRANSPORT_LABELS)) this.connectTransport(name)
		this.startDevInfoPolling()
	}

	resetTransports() {
		this.transports = Object.fromEntries(Object.keys(TRANSPORT_LABELS).map((name) => [name, { state: 'connecting' }]))
		this.devInfoPollFailed = false
	}

	// Rebuilds a single transport, leaving the others untouched.
	connectTransport(name) {
		const host = this.config.host
		if (this.destroyed || !host) return

		switch (name) {
			case 'audio':
				this.closeWebSocket('audioWs')
				this.audioWs = this.openWebSocket(host, 'audioWs', 'audio', (message) => this.handleAudioMessage(message))
				break
			case 'devinfo':
				this.closeWebSocket('devinfoWs')
				this.devinfoWs = this.openWebSocket(host, 'devinfoWs', 'devinfo', (message) =>
					this.handleDevInfoMessage(message),
				)
				break
			case 'ember':
				void this.ember.connect(host, EMBER_PORT)
				break
		}
	}

	// Marks a transport as connected, logging the recovery if it had been down.
	transportUp(name) {
		const transport = this.transports[name]
		const wasDown = isDown(transport)
		this.transports[name] = { state: 'ok' }

		if (wasDown) {
			this.log('info', `${TRANSPORT_LABELS[name]} reconnected`)
			// The devinfo feed only sends changes, so refresh everything it may have missed.
			if (name === 'devinfo') void this.pollDevInfo()
		}
		this.updateConnectionStatus()
	}

	// Marks a transport as down ('failed' never connected, 'lost' dropped after connecting) and retries only it.
	// The first failure is logged, repeats go to debug until the transport recovers.
	scheduleReconnect(name, reason, state = 'failed') {
		if (this.destroyed || !this.config.host || this.reconnectTimers[name]) return

		const repeat = isDown(this.transports[name])
		this.transports[name] = { state, message: `${TRANSPORT_LABELS[name]}: ${reason}` }
		this.log(
			repeat ? 'debug' : 'warn',
			`${TRANSPORT_LABELS[name]}: ${reason}, retrying every ${RECONNECT_DELAY / 1000}s`,
		)
		this.updateConnectionStatus()

		this.reconnectTimers[name] = setTimeout(() => {
			delete this.reconnectTimers[name]
			this.connectTransport(name)
		}, RECONNECT_DELAY)
	}

	clearReconnectTimers() {
		for (const timer of Object.values(this.reconnectTimers)) clearTimeout(timer)
		this.reconnectTimers = {}
	}

	// The metering socket decides failure vs. connected, the secondary transports can only downgrade Ok to a warning.
	updateConnectionStatus() {
		const host = this.config.host
		const { audio } = this.transports

		if (audio.state === 'connecting') return this.setStatus(InstanceStatus.Connecting, `Connecting to ${host}`)
		if (audio.state === 'lost') return this.setStatus(InstanceStatus.Disconnected, audio.message)
		if (audio.state === 'failed') return this.setStatus(InstanceStatus.ConnectionFailure, audio.message)

		const down = ['ember', 'devinfo'].filter((name) => isDown(this.transports[name]))
		if (down.length > 0) {
			const labels = down.map((name) => TRANSPORT_LABELS[name]).join(' and ')
			return this.setStatus(InstanceStatus.UnknownWarning, `${labels} unavailable`)
		}

		this.setStatus(InstanceStatus.Ok, `Connected to ${host}`)
	}

	setStatus(status, message) {
		if (this.lastStatus?.status === status && this.lastStatus.message === message) return
		this.lastStatus = { status, message }
		this.updateStatus(status, message)
	}

	closeWebSocket(key) {
		const ws = this[key]
		if (!ws) return

		// Cleared first so the close handler sees itself superseded and skips reconnecting.
		this[key] = null
		ws.terminate()
	}

	closeWebSockets() {
		for (const key of ['audioWs', 'devinfoWs']) this.closeWebSocket(key)
	}

	openWebSocket(host, key, protocol, onMessage) {
		const primary = key === 'audioWs'
		const url = `ws://${host}:${WS_PORT}`
		const ws = new WebSocket(url, protocol)

		let receiveTimer
		let opened = false
		// Most recent error, reported as the reconnect reason when the socket closes.
		let failure

		// Audio meters stream continuously, devinfo only sends changes.
		const resetReceiveTimer = () => {
			if (!primary) return
			clearTimeout(receiveTimer)

			receiveTimer = setTimeout(() => {
				if (this.destroyed || this[key] !== ws) return

				failure = `no data received for ${WS_MSG_TIMEOUT / 1000}s`
				ws.terminate()
			}, WS_MSG_TIMEOUT)
		}

		const connectTimer = setTimeout(() => {
			if (ws.readyState !== WebSocket.CONNECTING) return
			failure = 'connection timed out'
			ws.terminate()
		}, WS_CONNECT_TIMEOUT)

		ws.on('open', () => {
			clearTimeout(connectTimer)
			if (this.destroyed || this[key] !== ws) return
			opened = true
			resetReceiveTimer()
			this.log('info', `Connected to ${url} (${protocol})`)
			this.transportUp(protocol)
		})

		ws.on('close', (code) => {
			clearTimeout(connectTimer)
			clearTimeout(receiveTimer)
			this.log('debug', `${protocol} connection to ${host} closed with code ${code}`)
			if (this[key] !== ws) return

			this[key] = null
			const detail = failure ?? `closed with code ${code}`
			if (opened) this.scheduleReconnect(protocol, `connection lost (${detail})`, 'lost')
			else this.scheduleReconnect(protocol, `cannot connect to ${url} (${detail})`, 'failed')
		})

		ws.on('message', (data) => {
			if (this.destroyed || this[key] !== ws) return
			// Message received, reset timer
			resetReceiveTimer()
			let message

			try {
				message = JSON.parse(data.toString())
			} catch (error) {
				this.log('warn', `Ignoring invalid ${protocol} WebSocket JSON: ${error.message}`)
				return
			}

			onMessage(message)
		})

		ws.on('error', (error) => {
			failure = error.message || error.code || 'unknown error'
			this.log('debug', `${protocol} WebSocket error on ${host}: ${error.code ?? 'unknown'}: ${error.message}`)
		})
		return ws
	}

	handleAudioMessage(message) {
		const audio = message.audio || message
		const variableValues = {}
		const hasValue = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

		if (hasValue(audio, 'statusLeds')) {
			this.statusLeds = isAsserted(audio.statusLeds)
			variableValues.status_leds_enabled = this.statusLeds ? 1 : 0
			this.checkFeedbacks('StatusLeds')
		}

		// Handle meter data messages
		if (Array.isArray(audio.meter)) {
			let meterChanged = false

			for (let index = 0; index < Math.min(audio.meter.length, 8); index++) {
				if (!hasValue(audio.meter[index], 'segments')) continue

				const segments = Number(audio.meter[index].segments)
				if (!Number.isFinite(segments) || segments === this.meters[index]) continue

				this.meters[index] = segments
				variableValues[`input${index + 1}_meter`] = segments
				meterChanged = true
			}

			if (meterChanged) this.checkFeedbacks('MeterLevel')
		}

		// Handle input messages - M8R sends this on connect and a single-entry msg whenever one input changes
		if (Array.isArray(audio.inputs)) {
			let muteChanged = false

			for (const entry of audio.inputs) {
				if (!entry || typeof entry !== 'object') continue

				const index = Number(entry.idx)
				if (!Number.isInteger(index) || index < 0 || index > 7) continue

				if (hasValue(entry, 'lbl')) variableValues[`input${index + 1}_dante_label`] = entry.lbl
				if (hasValue(entry, 'fnm')) variableValues[`input${index + 1}_friendly_name`] = entry.fnm

				if (hasValue(entry, 'gpi_m')) {
					const gpiMute = isAsserted(entry.gpi_m)
					this.inputState[index] = { ...this.inputState[index], gpi_mute: gpiMute }
					variableValues[`input${index + 1}_gpi_mute`] = gpiMute
					Object.assign(variableValues, this.muteVariableValues(index))
					muteChanged = true
				}
			}

			if (muteChanged) this.checkFeedbacks('MuteState')
		}

		if (Object.keys(variableValues).length > 0) {
			this.setVariableValues(variableValues)
		}
	}

	startDevInfoPolling() {
		this.stopDevInfoPolling()
		if (!this.config.host) return

		void this.pollDevInfo()
		this.devInfoTimer = setInterval(() => void this.pollDevInfo(), DEVINFO_POLL_INTERVAL)
	}

	stopDevInfoPolling() {
		this.devInfoAbortController?.abort()
		this.devInfoAbortController = undefined
		if (this.devInfoTimer) {
			clearInterval(this.devInfoTimer)
			this.devInfoTimer = undefined
		}
	}

	async pollDevInfo() {
		const host = this.config.host
		if (!host || this.destroyed || this.devInfoAbortController) return

		const controller = new AbortController()
		this.devInfoAbortController = controller
		const isStale = () => controller.signal.aborted || this.destroyed || this.config.host !== host

		const url = `http://${host}/cgi/devInfo.cgi?_=${Date.now()}`

		try {
			const response = await fetch(url, {
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DEVINFO_CGI_TIMEOUT)]),
			})
			if (isStale()) return
			if (!response.ok) {
				this.devInfoPollFailure(`HTTP ${response.status}`)
				return
			}

			const message = await response.json()
			if (isStale()) return
			if (this.devInfoPollFailed) {
				this.devInfoPollFailed = false
				this.log('info', 'devInfo.cgi poll recovered')
			}
			this.handleDevInfoMessage(message)
		} catch (error) {
			if (!isStale()) this.devInfoPollFailure(error.message)
		} finally {
			if (this.devInfoAbortController === controller) this.devInfoAbortController = undefined
		}
	}

	// Logs the first poll failure, then repeats at debug until a poll succeeds.
	devInfoPollFailure(reason) {
		this.log(this.devInfoPollFailed ? 'debug' : 'warn', `devInfo.cgi poll failed: ${reason}`)
		this.devInfoPollFailed = true
	}

	// The devinfo ws feed sends only the fields that changed since the device last evaluated them.
	handleDevInfoMessage(message) {
		const info = message.devinfo || message
		const variableValues = {}
		const hasValue = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

		if (hasValue(info, 'uptime')) {
			// uptime arrives padded, e.g. ' 3 hrs  0 mins'.
			variableValues.device_uptime = String(info.uptime).replace(/\s+/g, ' ').trim()
		}

		if (hasValue(info, 'ctemp')) {
			const raw = String(info.ctemp).trim()
			const temperature = Number(raw)
			if (raw !== '' && Number.isFinite(temperature)) {
				variableValues.device_temperature = temperature
			} else {
				this.log('warn', `Ignoring unreadable ctemp value: ${JSON.stringify(info.ctemp)}`)
			}
		}

		let powerChanged = false
		for (const [key, index, variable] of [
			['ac1', 1, 'primary_poe_present'],
			['ac2', 2, 'secondary_poe_present'],
		]) {
			if (!hasValue(info, key)) continue

			const present = parsePowerPresence(info[key])
			if (present === undefined) {
				// Keep the last known state
				this.log('warn', `Ignoring indeterminate ${key} value: ${JSON.stringify(info[key])}`)
				continue
			}

			this.powerInputs[index] = present
			variableValues[variable] = present ? 'Present' : 'Not Present'
			powerChanged = true
		}

		if (Object.keys(variableValues).length > 0) this.setVariableValues(variableValues)
		if (powerChanged) this.checkFeedbacks('PowerInput')
	}

	muteVariableValues(input) {
		return { [`input${input + 1}_mute_active`]: isMuted(this.inputState?.[input]) }
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	updatePresets() {
		UpdatePresets(this)
	}
}

module.exports = SonifexM8RInstance
module.exports.UpgradeScripts = UpgradeScripts

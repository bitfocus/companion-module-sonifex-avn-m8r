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
const WS_MSG_TIMEOUT = 10000
const WS_CONNECT_TIMEOUT = 5000
const EMBER_PORT = 9000
const DEVINFO_CGI_TIMEOUT = 5000
const DEVINFO_POLL_INTERVAL = 30000
const RECONNECT_DELAY = 5000

class SonifexM8RInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.ember = new EmberControl(this)
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
		this.clearReconnectTimer()
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

	connect() {
		if (this.destroyed) return
		this.clearReconnectTimer()
		this.closeWebSockets()

		const host = this.config.host
		if (!host) {
			this.stopDevInfoPolling()
			void this.ember.disconnect()
			this.updateStatus(InstanceStatus.BadConfig, 'Target IP is not defined')
			return
		}

		this.updateStatus(InstanceStatus.Connecting, `Connecting to ${host}`)
		this.audioWs = this.openWebSocket(host, 'audioWs', 'audio', (message) => this.handleAudioMessage(message))
		this.devinfoWs = this.openWebSocket(host, 'devinfoWs', 'devinfo', (message) => this.handleDevInfoMessage(message))
		this.startDevInfoPolling()
		void this.initEmber(host)
	}

	scheduleReconnect(reason) {
		if (this.destroyed || this.reconnectTimer || !this.config.host) return

		this.updateStatus(InstanceStatus.Connecting, `${reason} - reconnecting`)
		this.log('info', `${reason}, reconnecting in ${RECONNECT_DELAY / 1000}s...`)

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connect()
		}, RECONNECT_DELAY)
	}

	clearReconnectTimer() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
	}

	async initEmber(host) {
		if (!host) return
		await this.ember.connect(host, EMBER_PORT)
	}

	closeWebSockets() {
		for (const key of ['audioWs', 'devinfoWs']) {
			const ws = this[key]
			if (!ws) continue

			// Cleared first so the close handler sees itself superseded and skips reconnecting.
			this[key] = null
			ws.terminate()
		}
	}

	openWebSocket(host, key, protocol, onMessage) {
		const primary = key === 'audioWs'
		const url = `ws://${host}:${WS_PORT}`
		const ws = new WebSocket(url, protocol)

		let receiveTimer

		// Audio meters stream continuously, devinfo only sends changes.
		const resetReceiveTimer = () => {
			if (!primary) return
			clearTimeout(receiveTimer)

			receiveTimer = setTimeout(() => {
				if (this.destroyed || this[key] !== ws) return

				this.log('warn', 'Timer expired, WS connection may have expired.')
				ws.terminate()
			}, WS_MSG_TIMEOUT)
		}

		const connectTimer = setTimeout(() => {
			if (ws.readyState !== WebSocket.CONNECTING) return
			this.log('warn', `${protocol} connection to ${host} timed out`)
			ws.terminate()
		}, WS_CONNECT_TIMEOUT)

		ws.on('open', () => {
			clearTimeout(connectTimer)
			if (this.destroyed || this[key] !== ws) return
			resetReceiveTimer()
			if (primary) this.updateStatus(InstanceStatus.Ok, `Connected to ${host}`)
			this.log('info', `Connected to ${url} (${protocol})`)
		})

		ws.on('close', (code) => {
			clearTimeout(connectTimer)
			clearTimeout(receiveTimer)
			this.log('info', `${protocol} connection to ${host} closed with code ${code}`)
			if (this[key] !== ws) return

			this[key] = null
			// Retry connection on close
			this.scheduleReconnect(`${protocol} connection to ${host} closed with code ${code}`)
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
			this.log('error', `${protocol} WebSocket error on ${host}: ${error.code ?? 'unknown'}: ${error.message}`)
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
				this.log('info', `devInfo.cgi returned HTTP ${response.status}`)
				return
			}

			const message = await response.json()
			if (!isStale()) this.handleDevInfoMessage(message)
		} catch (error) {
			if (!isStale()) this.log('error', `devInfo.cgi poll failed: ${error.message}`)
		} finally {
			if (this.devInfoAbortController === controller) this.devInfoAbortController = undefined
		}
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

import {createHash} from 'crypto'
import type {Logger} from '@medusajs/framework/types'

// --- Klarna API types ---

export type KlarnaOrderLineType = 'physical' | 'digital' | 'shipping_fee' | 'discount' | 'surcharge' | 'gift_card' | 'store_credit'

export type KlarnaOrderLine = {
	name: string
	quantity: number
	unit_price: number
	total_amount: number
	total_tax_amount: number
	tax_rate: number
	type: KlarnaOrderLineType
	reference?: string
}

export type KlarnaAssetUrls = {
	descriptive: string
	standard: string
}

export type KlarnaPaymentMethodCategory = {
	identifier: string
	name: string
	asset_urls: KlarnaAssetUrls
}

export type KlarnaSessionResponse = {
	session_id: string
	client_token: string
	payment_method_categories: Array<KlarnaPaymentMethodCategory>
}

export enum KlarnaFraudStatus {
	ACCEPTED = 'ACCEPTED',
	PENDING = 'PENDING',
	REJECTED = 'REJECTED'
}

export enum KlarnaOrderStatus {
	AUTHORIZED = 'AUTHORIZED',
	PART_CAPTURED = 'PART_CAPTURED',
	CAPTURED = 'CAPTURED',
	CANCELLED = 'CANCELLED',
	EXPIRED = 'EXPIRED',
	CLOSED = 'CLOSED'
}

export enum KlarnaWebhookEvent {
	FRAUD_RISK_ACCEPTED = 'FRAUD_RISK_ACCEPTED',
	FRAUD_RISK_REJECTED = 'FRAUD_RISK_REJECTED',
	FRAUD_RISK_STOPPED = 'FRAUD_RISK_STOPPED'
}

// POST /payments/v1/authorizations/{token}/order — returns `order_status`
export type KlarnaOrderResponse = {
	order_id: string
	order_status: KlarnaOrderStatus
	fraud_status?: KlarnaFraudStatus
	redirect_url?: string
}

// GET /ordermanagement/v1/orders/{id} — returns `status` (different field name)
export type KlarnaOrderDetails = {
	order_id: string
	status: KlarnaOrderStatus
	fraud_status: KlarnaFraudStatus
	order_amount: number
	merchant_reference1?: string
}

export type KlarnaHppSessionResponse = {
	redirect_url: string
	session_id: string
	session_url: string
	expires_at: string
}

export enum KlarnaHppSessionStatus {
	WAITING = 'WAITING',
	IN_PROGRESS = 'IN_PROGRESS',
	COMPLETED = 'COMPLETED',
	DISABLED = 'DISABLED',
	CANCELLED = 'CANCELLED'
}

export type KlarnaHppSessionStatusResponse = {
	session_id: string
	status: KlarnaHppSessionStatus
	authorization_token?: string
}

type KlarnaErrorResponse = {
	error_code: string
	error_messages: Array<string>
	correlation_id: string
}

// --- Request types ---

export type KlarnaSessionRequest = {
	acquiring_channel: string
	purchase_country: string
	purchase_currency: string
	locale: string
	order_amount: number
	order_tax_amount: number
	order_lines: Array<KlarnaOrderLine>
	intent: string
}

export type KlarnaCreateOrderRequest = {
	purchase_country: string
	purchase_currency: string
	order_amount: number
	order_tax_amount: number
	order_lines: Array<KlarnaOrderLine>
	merchant_reference1?: string
}

export type KlarnaHppMerchantUrls = {
	success: string
	cancel: string
	back: string
	failure: string
	error: string
}

export type KlarnaHppOptions = {
	place_order_mode: string
	purchase_type: string
}

export type KlarnaHppSessionRequest = {
	payment_session_url: string
	merchant_urls: KlarnaHppMerchantUrls
	options: KlarnaHppOptions
}

export type KlarnaUpdateSessionRequest = {
	purchase_country: string
	purchase_currency: string
	locale: string
	order_amount: number
	order_tax_amount: number
	order_lines: Array<KlarnaOrderLine>
}

// --- API error with HTTP status ---

export class KlarnaApiError extends Error {
	readonly statusCode: number

	constructor(message: string, statusCode: number) {
		super(message)
		this.name = 'KlarnaApiError'
		this.statusCode = statusCode
	}
}

// --- Base URL map ---

export const VALID_ENVIRONMENTS = ['playground', 'live'] as const
export const VALID_REGIONS = ['eu', 'na', 'oc'] as const

export type KlarnaEnvironment = (typeof VALID_ENVIRONMENTS)[number]
export type KlarnaRegion = (typeof VALID_REGIONS)[number]

const BASE_URLS: Record<KlarnaEnvironment, Record<KlarnaRegion, string>> = {
	playground: {
		eu: 'https://api.playground.klarna.com',
		na: 'https://api-na.playground.klarna.com',
		oc: 'https://api-oc.playground.klarna.com'
	},
	live: {
		eu: 'https://api.klarna.com',
		na: 'https://api-na.klarna.com',
		oc: 'https://api-oc.klarna.com'
	}
}

// --- Client ---

export class KlarnaClient {
	private static readonly REQUEST_TIMEOUT_MS = 15_000
	private static readonly MAX_RETRIES = 2
	private static readonly RETRY_BASE_MS = 500

	readonly baseUrl: string

	constructor(
		environment: KlarnaEnvironment,
		region: KlarnaRegion,
		private readonly apiKey: string,
		private readonly logger: Logger
	) {
		this.baseUrl = BASE_URLS[environment][region]
	}

	// --- HTTP transport ---

	private async request<T>(path: string, method: 'GET' | 'POST' | 'DELETE', body?: object, extraHeaders?: Record<string, string>): Promise<T> {
		const url = `${this.baseUrl}${path}`
		const jsonBody = body ? JSON.stringify(body) : undefined

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: `Basic ${this.apiKey}`,
			...extraHeaders
		}

		let lastError: unknown

		for (let attempt = 0; attempt <= KlarnaClient.MAX_RETRIES; attempt++) {
			if (attempt > 0) {
				const delay = KlarnaClient.RETRY_BASE_MS * Math.pow(2, attempt - 1)
				this.logger.warn(`Klarna API ${method} ${path}: retry ${attempt}/${KlarnaClient.MAX_RETRIES} after ${delay}ms`)
				await new Promise(resolve => setTimeout(resolve, delay))
			}

			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), KlarnaClient.REQUEST_TIMEOUT_MS)

			let response: Response
			try {
				response = await fetch(url, {
					method,
					headers,
					signal: controller.signal,
					...(jsonBody && {body: jsonBody})
				})
			} catch (error) {
				clearTimeout(timeout)
				lastError = error
				if (controller.signal.aborted) {
					lastError = new KlarnaApiError(`Klarna API ${method} ${path} timed out after ${KlarnaClient.REQUEST_TIMEOUT_MS}ms`, 0)
				}
				continue
			} finally {
				clearTimeout(timeout)
			}

			if (response.status === 204) {
				return {} as T
			}

			const responseText = await response.text()

			if (!response.ok) {
				let errorDetail: string
				try {
					const errorBody = JSON.parse(responseText) as KlarnaErrorResponse
					errorDetail = `[${errorBody.error_code}] ${errorBody.error_messages?.join(', ')} (correlation: ${errorBody.correlation_id})`
				} catch {
					errorDetail = responseText
				}

				const apiError = new KlarnaApiError(`Klarna API ${method} ${path} failed (${response.status}): ${errorDetail}`, response.status)

				if (response.status >= 500) {
					lastError = apiError
					continue
				}

				this.logger.error(apiError.message)
				throw apiError
			}

			if (!responseText) {
				return {} as T
			}

			return JSON.parse(responseText) as T
		}

		this.logger.error(`Klarna API ${method} ${path} failed after ${KlarnaClient.MAX_RETRIES + 1} attempts: ${lastError}`)
		throw lastError
	}

	private idempotencyHeaders(orderId: string, operation: string): Record<string, string> {
		const key = createHash('sha256').update(`${orderId}:${operation}`).digest('hex')
		return {'Klarna-Idempotency-Key': key}
	}

	// --- Payment Sessions ---

	async createSession(body: KlarnaSessionRequest): Promise<KlarnaSessionResponse> {
		return this.request('/payments/v1/sessions', 'POST', body)
	}

	async getSession(sessionId: string): Promise<KlarnaSessionResponse> {
		return this.request(`/payments/v1/sessions/${sessionId}`, 'GET')
	}

	async updateSession(sessionId: string, body: KlarnaUpdateSessionRequest): Promise<void> {
		await this.request(`/payments/v1/sessions/${sessionId}`, 'POST', body)
	}

	// --- HPP Sessions ---

	async createHppSession(body: KlarnaHppSessionRequest): Promise<KlarnaHppSessionResponse> {
		return this.request('/hpp/v1/sessions', 'POST', body)
	}

	async getHppSessionStatus(sessionId: string): Promise<KlarnaHppSessionStatusResponse> {
		return this.request(`/hpp/v1/sessions/${sessionId}`, 'GET')
	}

	// --- Authorizations ---

	async createOrder(authorizationToken: string, body: KlarnaCreateOrderRequest): Promise<KlarnaOrderResponse> {
		return this.request(`/payments/v1/authorizations/${authorizationToken}/order`, 'POST', body)
	}

	async deleteAuthorization(authorizationToken: string): Promise<void> {
		await this.request(`/payments/v1/authorizations/${authorizationToken}`, 'DELETE')
	}

	// --- Order Management ---

	async getOrder(orderId: string): Promise<KlarnaOrderDetails> {
		return this.request(`/ordermanagement/v1/orders/${orderId}`, 'GET')
	}

	async captureOrder(orderId: string, amount: number): Promise<void> {
		await this.request(`/ordermanagement/v1/orders/${orderId}/captures`, 'POST', {captured_amount: amount}, this.idempotencyHeaders(orderId, 'capture'))
	}

	async refundOrder(orderId: string, amount: number): Promise<void> {
		await this.request(
			`/ordermanagement/v1/orders/${orderId}/refunds`,
			'POST',
			{refund_amount: amount},
			this.idempotencyHeaders(orderId, `refund:${amount}`)
		)
	}
}

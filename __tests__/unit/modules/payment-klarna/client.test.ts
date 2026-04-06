import type {Logger} from '@medusajs/framework/types'
import {KlarnaClient, KlarnaApiError, VALID_ENVIRONMENTS, VALID_REGIONS} from '../../../../src/modules/payment-klarna/client'
import type {KlarnaSessionRequest} from '../../../../src/modules/payment-klarna/client'

const mockLogger = {
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn()
} as unknown as Logger

const mockSessionRequest: KlarnaSessionRequest = {
	acquiring_channel: 'ECOMMERCE',
	purchase_country: 'NL',
	purchase_currency: 'EUR',
	locale: 'nl-NL',
	order_amount: 1000,
	order_tax_amount: 174,
	order_lines: [{name: 'Item', quantity: 1, unit_price: 1000, total_amount: 1000, total_tax_amount: 174, tax_rate: 2100, type: 'physical'}],
	intent: 'buy'
}

const mockResponse = (status: number, body?: object | string): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		text: () => Promise.resolve(typeof body === 'string' ? body : body ? JSON.stringify(body) : '')
	}) as unknown as Response

let client: KlarnaClient

beforeEach(() => {
	jest.clearAllMocks()
	global.fetch = jest.fn()
	client = new KlarnaClient('playground', 'eu', 'dGVzdDp0ZXN0', mockLogger)
})

describe('KlarnaApiError', () => {
	it('should create error with message, statusCode and name', () => {
		const error = new KlarnaApiError('test error', 400)
		expect(error.message).toBe('test error')
		expect(error.statusCode).toBe(400)
		expect(error.name).toBe('KlarnaApiError')
		expect(error).toBeInstanceOf(Error)
	})
})

describe('constants', () => {
	it('should export valid environments', () => {
		expect(VALID_ENVIRONMENTS).toEqual(['playground', 'live'])
	})

	it('should export valid regions', () => {
		expect(VALID_REGIONS).toEqual(['eu', 'na', 'oc'])
	})
})

describe('KlarnaClient constructor', () => {
	it('should set baseUrl for playground/eu', () => {
		expect(new KlarnaClient('playground', 'eu', 'key', mockLogger).baseUrl).toBe('https://api.playground.klarna.com')
	})

	it('should set baseUrl for playground/na', () => {
		expect(new KlarnaClient('playground', 'na', 'key', mockLogger).baseUrl).toBe('https://api-na.playground.klarna.com')
	})

	it('should set baseUrl for playground/oc', () => {
		expect(new KlarnaClient('playground', 'oc', 'key', mockLogger).baseUrl).toBe('https://api-oc.playground.klarna.com')
	})

	it('should set baseUrl for live/eu', () => {
		expect(new KlarnaClient('live', 'eu', 'key', mockLogger).baseUrl).toBe('https://api.klarna.com')
	})

	it('should set baseUrl for live/na', () => {
		expect(new KlarnaClient('live', 'na', 'key', mockLogger).baseUrl).toBe('https://api-na.klarna.com')
	})

	it('should set baseUrl for live/oc', () => {
		expect(new KlarnaClient('live', 'oc', 'key', mockLogger).baseUrl).toBe('https://api-oc.klarna.com')
	})
})

describe('request (via public methods)', () => {
	it('should send GET with correct headers', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {session_id: 's1', client_token: 'ct', payment_method_categories: []}))

		await client.getSession('s1')

		expect(global.fetch).toHaveBeenCalledWith(
			'https://api.playground.klarna.com/payments/v1/sessions/s1',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					'Content-Type': 'application/json',
					Authorization: 'Basic dGVzdDp0ZXN0'
				})
			})
		)
	})

	it('should send POST with JSON body', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {session_id: 's1', client_token: 'ct', payment_method_categories: []}))

		await client.createSession(mockSessionRequest)

		expect(global.fetch).toHaveBeenCalledWith(
			'https://api.playground.klarna.com/payments/v1/sessions',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify(mockSessionRequest)
			})
		)
	})

	it('should send DELETE request', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await client.deleteAuthorization('auth_token')

		expect(global.fetch).toHaveBeenCalledWith(
			'https://api.playground.klarna.com/payments/v1/authorizations/auth_token',
			expect.objectContaining({method: 'DELETE'})
		)
	})

	it('should return parsed JSON for successful response', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {session_id: 's1', client_token: 'ct', payment_method_categories: []}))

		const result = await client.getSession('s1')

		expect(result).toEqual({session_id: 's1', client_token: 'ct', payment_method_categories: []})
	})

	it('should return empty object for 204 response', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await expect(client.captureOrder('ord1', 1000)).resolves.toBeUndefined()
	})

	it('should return empty object for successful response with empty body', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200))

		await expect(
			client.updateSession('s1', {
				purchase_country: 'NL',
				purchase_currency: 'EUR',
				locale: 'nl-NL',
				order_amount: 1000,
				order_tax_amount: 0,
				order_lines: []
			})
		).resolves.toBeUndefined()
	})

	it('should throw KlarnaApiError for 4xx with JSON error body', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(
			mockResponse(400, {error_code: 'BAD_VALUE', error_messages: ['Invalid field'], correlation_id: 'corr-1'})
		)

		await expect(client.createSession(mockSessionRequest)).rejects.toThrow(KlarnaApiError)
		await expect(client.createSession(mockSessionRequest)).rejects.toThrow('[BAD_VALUE] Invalid field (correlation: corr-1)')
	})

	it('should throw KlarnaApiError for 4xx with non-JSON error body', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(422, 'plain text error'))

		await expect(client.createSession(mockSessionRequest)).rejects.toThrow('plain text error')
	})

	it('should log error before throwing on 4xx', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(400, {error_code: 'ERR', error_messages: ['msg'], correlation_id: 'c1'}))

		await expect(client.createSession(mockSessionRequest)).rejects.toThrow()
		expect(mockLogger.error).toHaveBeenCalled()
	})

	it('should not retry on 4xx errors', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(400, {error_code: 'ERR', error_messages: ['msg'], correlation_id: 'c1'}))

		await expect(client.createSession(mockSessionRequest)).rejects.toThrow()
		expect(global.fetch).toHaveBeenCalledTimes(1)
	})

	it('should retry on 5xx errors and succeed on subsequent attempt', async () => {
		;(global.fetch as jest.Mock)
			.mockResolvedValueOnce(mockResponse(500, {error_code: 'SERVER', error_messages: ['fail'], correlation_id: 'c1'}))
			.mockResolvedValueOnce(mockResponse(200, {order_id: 'o1', status: 'AUTHORIZED', fraud_status: 'ACCEPTED', order_amount: 1000}))

		const result = await client.getOrder('o1')

		expect(result.order_id).toBe('o1')
		expect(global.fetch).toHaveBeenCalledTimes(2)
		expect(mockLogger.warn).toHaveBeenCalled()
	})

	it('should throw after exhausting all retries on 5xx', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(500, {error_code: 'SERVER', error_messages: ['fail'], correlation_id: 'c1'}))

		await expect(client.getOrder('o1')).rejects.toThrow(KlarnaApiError)
		expect(global.fetch).toHaveBeenCalledTimes(3)
		expect(mockLogger.error).toHaveBeenCalled()
	})

	it('should retry on network fetch error and throw after retries exhausted', async () => {
		;(global.fetch as jest.Mock).mockRejectedValue(new Error('network error'))

		await expect(client.getSession('s1')).rejects.toThrow('network error')
		expect(global.fetch).toHaveBeenCalledTimes(3)
	})

	it('should throw KlarnaApiError on request timeout', async () => {
		;(global.fetch as jest.Mock).mockImplementation(
			(_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
				})
		)

		await expect(client.getSession('s1')).rejects.toThrow(/timed out/)
	}, 60000)
})

describe('createSession', () => {
	it('should POST to /payments/v1/sessions', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {session_id: 's1', client_token: 'ct', payment_method_categories: []}))

		const result = await client.createSession(mockSessionRequest)

		expect(result.session_id).toBe('s1')
	})
})

describe('getSession', () => {
	it('should GET /payments/v1/sessions/{sessionId}', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {session_id: 's1', client_token: 'ct', payment_method_categories: []}))

		const result = await client.getSession('s1')

		expect(result.session_id).toBe('s1')
	})
})

describe('updateSession', () => {
	it('should POST to /payments/v1/sessions/{sessionId}', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await client.updateSession('s1', {
			purchase_country: 'NL',
			purchase_currency: 'EUR',
			locale: 'nl-NL',
			order_amount: 1000,
			order_tax_amount: 0,
			order_lines: []
		})

		expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/payments/v1/sessions/s1'), expect.anything())
	})
})

describe('createHppSession', () => {
	it('should POST to /hpp/v1/sessions', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(
			mockResponse(200, {redirect_url: 'https://hpp.klarna.com', session_id: 'hpp1', session_url: 'url', expires_at: '2025-01-01'})
		)

		const result = await client.createHppSession({
			payment_session_url: 'https://api.playground.klarna.com/payments/v1/sessions/s1',
			merchant_urls: {success: 'u', cancel: 'u', back: 'u', failure: 'u', error: 'u'},
			options: {place_order_mode: 'NONE', purchase_type: 'BUY'}
		})

		expect(result.redirect_url).toBe('https://hpp.klarna.com')
	})
})

describe('getHppSessionStatus', () => {
	it('should GET /hpp/v1/sessions/{sessionId}', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {session_id: 'hpp1', status: 'COMPLETED', authorization_token: 'at1'}))

		const result = await client.getHppSessionStatus('hpp1')

		expect(result.status).toBe('COMPLETED')
	})
})

describe('createOrder', () => {
	it('should POST to /payments/v1/authorizations/{token}/order', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, {order_id: 'o1', order_status: 'AUTHORIZED'}))

		const result = await client.createOrder('auth_tok', {
			purchase_country: 'NL',
			purchase_currency: 'EUR',
			order_amount: 1000,
			order_tax_amount: 0,
			order_lines: [{name: 'Item', quantity: 1, unit_price: 1000, total_amount: 1000, total_tax_amount: 0, tax_rate: 0, type: 'physical' as const}]
		})

		expect(result.order_id).toBe('o1')
		expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/authorizations/auth_tok/order'), expect.anything())
	})
})

describe('deleteAuthorization', () => {
	it('should DELETE /payments/v1/authorizations/{token}', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await client.deleteAuthorization('auth_tok')

		expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/authorizations/auth_tok'), expect.objectContaining({method: 'DELETE'}))
	})
})

describe('getOrder', () => {
	it('should GET /ordermanagement/v1/orders/{orderId}', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(
			mockResponse(200, {order_id: 'o1', status: 'AUTHORIZED', fraud_status: 'ACCEPTED', order_amount: 1000})
		)

		const result = await client.getOrder('o1')

		expect(result.order_id).toBe('o1')
	})
})

describe('captureOrder', () => {
	it('should POST with captured_amount and idempotency header', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await client.captureOrder('o1', 1000)

		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/orders/o1/captures'),
			expect.objectContaining({
				body: JSON.stringify({captured_amount: 1000}),
				headers: expect.objectContaining({'Klarna-Idempotency-Key': expect.any(String)})
			})
		)
	})
})

describe('refundOrder', () => {
	it('should POST with refund_amount and idempotency header including amount', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await client.refundOrder('o1', 500)

		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/orders/o1/refunds'),
			expect.objectContaining({
				body: JSON.stringify({refund_amount: 500}),
				headers: expect.objectContaining({'Klarna-Idempotency-Key': expect.any(String)})
			})
		)
	})

	it('should generate different idempotency keys for different amounts', async () => {
		;(global.fetch as jest.Mock).mockResolvedValue(mockResponse(204))

		await client.refundOrder('o1', 500)
		await client.refundOrder('o1', 300)

		const calls = (global.fetch as jest.Mock).mock.calls
		const key1 = calls[0][1].headers['Klarna-Idempotency-Key']
		const key2 = calls[1][1].headers['Klarna-Idempotency-Key']
		expect(key1).not.toBe(key2)
	})
})

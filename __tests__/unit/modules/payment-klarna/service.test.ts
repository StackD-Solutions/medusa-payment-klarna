import type {Logger} from '@medusajs/framework/types'
import {KlarnaApiError, KlarnaFraudStatus, KlarnaHppSessionStatus, KlarnaOrderStatus, KlarnaWebhookEvent} from '../../../../src'
import type {KlarnaClient} from '../../../../src/modules/payment-klarna/client'

jest.mock('@medusajs/framework/utils', () => {
	class MockBigNumber {
		numeric: number
		constructor(val: number | string | {numeric: number}) {
			this.numeric = typeof val === 'object' ? val.numeric : Number(val)
		}
	}

	class MockMedusaError extends Error {
		static Types = {INVALID_DATA: 'invalid_data', UNEXPECTED_STATE: 'unexpected_state'}
		type: string
		constructor(type: string, message: string) {
			super(message)
			this.type = type
		}
	}

	return {
		AbstractPaymentProvider: class {
			config: Record<string, unknown>
			constructor(_container: unknown, config: Record<string, unknown>) {
				this.config = config
			}
		},
		BigNumber: MockBigNumber,
		MathBN: {mult: (_a: unknown, _b: unknown) => Number(_a) * Number(_b)},
		MedusaError: MockMedusaError,
		Modules: {PAYMENT: 'payment'},
		ModuleProvider: (_module: string, opts: unknown) => opts,
		PaymentActions: {NOT_SUPPORTED: 'not_supported', AUTHORIZED: 'authorized', FAILED: 'failed'},
		PaymentSessionStatus: {
			AUTHORIZED: 'authorized',
			PENDING: 'pending',
			CAPTURED: 'captured',
			CANCELED: 'canceled',
			REQUIRES_MORE: 'requires_more',
			ERROR: 'error'
		}
	}
})

const mockLogger = {
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn()
} as unknown as Logger

const mockClient = {
	baseUrl: 'https://api.playground.klarna.com',
	createSession: jest.fn(),
	getSession: jest.fn(),
	updateSession: jest.fn(),
	createHppSession: jest.fn(),
	getHppSessionStatus: jest.fn(),
	createOrder: jest.fn(),
	deleteAuthorization: jest.fn(),
	getOrder: jest.fn(),
	captureOrder: jest.fn(),
	refundOrder: jest.fn()
} as unknown as KlarnaClient

const validOptions = {
	apiKey: 'klarna_test_api_MzRkMjY',
	environment: 'playground' as const,
	region: 'eu' as const,
	defaultCountry: 'NL',
	defaultLocale: 'nl-NL',
	storefrontUrl: 'https://shop.com'
}

function createService(configOverrides?: Partial<typeof validOptions> & Record<string, unknown>) {
	const {default: KlarnaPaymentService} = require('../../../../src/modules/payment-klarna/service')
	const service = new KlarnaPaymentService({logger: mockLogger}, {...validOptions, ...configOverrides})
	service['client_'] = mockClient
	return service
}

const validPaymentData = {
	session_id: 'sess_1',
	client_token: 'ct',
	payment_method_categories: [],
	purchase_country: 'NL',
	purchase_currency: 'EUR',
	locale: 'nl-NL',
	order_amount: 1000,
	order_tax_amount: 0,
	order_lines: [{name: 'Order total', quantity: 1, unit_price: 1000, total_amount: 1000, total_tax_amount: 0, tax_rate: 0, type: 'physical'}]
}

beforeEach(() => {
	jest.clearAllMocks()
})

describe('constructor', () => {
	it('should base64-encode apiKey when it contains a colon', () => {
		const service = createService({apiKey: 'user:pass'})
		expect(service.config.apiKey).toBe(Buffer.from('user:pass').toString('base64'))
	})

	it('should pass plain API key unchanged', () => {
		const service = createService({apiKey: 'klarna_test_api_XYZ'})
		expect(service.config.apiKey).toBe('klarna_test_api_XYZ')
	})

	it('should strip trailing slashes from storefrontUrl', () => {
		const service = createService({storefrontUrl: 'https://shop.com///'})
		expect(service.config.storefrontUrl).toBe('https://shop.com')
	})
})

describe('validateOptions', () => {
	let KlarnaPaymentService: {validateOptions: (options: Record<string, unknown>) => void}

	beforeAll(() => {
		KlarnaPaymentService = require('../../../../src/modules/payment-klarna/service').default
	})

	const valid: Record<string, unknown> = {...validOptions}

	it('should accept fully valid options', () => {
		expect(() => KlarnaPaymentService.validateOptions(valid)).not.toThrow()
	})

	it('should accept valid options with optional paths', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, callbackPath: '/callback', checkoutPath: '/pay'})).not.toThrow()
	})

	it('should throw when apiKey is missing', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, apiKey: undefined})).toThrow('apiKey')
	})

	it('should throw when apiKey is not a string', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, apiKey: 123})).toThrow('apiKey')
	})

	it('should accept plain API key', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, apiKey: 'klarna_test_api_XYZ'})).not.toThrow()
	})

	it('should accept raw credential apiKey', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, apiKey: 'user:pass'})).not.toThrow()
	})

	it('should throw when environment is missing', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, environment: undefined})).toThrow('environment')
	})

	it('should throw when environment is invalid', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, environment: 'staging'})).toThrow('environment')
	})

	it('should throw when region is missing', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, region: undefined})).toThrow('region')
	})

	it('should throw when region is invalid', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, region: 'ap'})).toThrow('region')
	})

	it('should throw when defaultCountry is missing', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, defaultCountry: undefined})).toThrow('defaultCountry')
	})

	it('should throw when defaultCountry is not a string', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, defaultCountry: 42})).toThrow('defaultCountry')
	})

	it('should throw when defaultCountry is not 2 characters', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, defaultCountry: 'NLD'})).toThrow('defaultCountry')
	})

	it('should throw when defaultLocale is missing', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, defaultLocale: undefined})).toThrow('defaultLocale')
	})

	it('should throw when defaultLocale is not a string', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, defaultLocale: 42})).toThrow('defaultLocale')
	})

	it('should throw when storefrontUrl is missing', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, storefrontUrl: undefined})).toThrow('storefrontUrl')
	})

	it('should throw when storefrontUrl is not a string', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, storefrontUrl: 42})).toThrow('storefrontUrl')
	})

	it('should throw when callbackPath does not start with /', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, callbackPath: 'no-slash'})).toThrow('callbackPath')
	})

	it('should throw when callbackPath is not a string', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, callbackPath: 42})).toThrow('callbackPath')
	})

	it('should throw when checkoutPath does not start with /', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, checkoutPath: 'no-slash'})).toThrow('checkoutPath')
	})

	it('should throw when checkoutPath is not a string', () => {
		expect(() => KlarnaPaymentService.validateOptions({...valid, checkoutPath: 42})).toThrow('checkoutPath')
	})
})

describe('initiatePayment', () => {
	it('should create session and HPP session and return session data', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 'sess_1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'https://hpp.klarna.com', session_id: 'hpp_1'})

		const result = await service.initiatePayment({amount: 10, currency_code: 'EUR'})

		expect(result.id).toBe('sess_1')
		expect(result.data.session_id).toBe('sess_1')
		expect(result.data.hpp_redirect_url).toBe('https://hpp.klarna.com')
		expect(result.data.order_amount).toBe(1000)
	})

	it('should use tax_amount from data when provided', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({amount: 10, currency_code: 'EUR', data: {tax_amount: 2.1}})

		expect(result.data.order_tax_amount).toBe(210)
	})

	it('should default tax amount to 0 when not provided', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({amount: 10, currency_code: 'EUR'})

		expect(result.data.order_tax_amount).toBe(0)
	})

	it('should handle zero-decimal currency (JPY)', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({amount: 1000, currency_code: 'JPY'})

		expect(result.data.order_amount).toBe(1000)
	})

	it('should use configured callbackPath and checkoutPath', async () => {
		const service = createService({callbackPath: '/custom/callback', checkoutPath: '/custom/pay'})
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		await service.initiatePayment({amount: 10, currency_code: 'EUR'})

		const hppCall = (mockClient.createHppSession as jest.Mock).mock.calls[0][0]
		expect(hppCall.merchant_urls.success).toContain('/custom/callback')
		expect(hppCall.merchant_urls.cancel).toContain('/custom/pay')
	})

	it('should use default paths with language prefix when not configured', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		await service.initiatePayment({amount: 10, currency_code: 'EUR'})

		const hppCall = (mockClient.createHppSession as jest.Mock).mock.calls[0][0]
		expect(hppCall.merchant_urls.success).toContain('/nl/order/callback/klarna')
		expect(hppCall.merchant_urls.cancel).toContain('/nl/checkout')
	})

	it('should use purchase_country and locale from data when provided', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		await service.initiatePayment({amount: 10, currency_code: 'EUR', data: {purchase_country: 'se', locale: 'sv-SE'}})

		const sessionCall = (mockClient.createSession as jest.Mock).mock.calls[0][0]
		expect(sessionCall.purchase_country).toBe('SE')
		expect(sessionCall.locale).toBe('sv-SE')
	})

	it('should pass line_items through to order lines', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({
			amount: 10,
			currency_code: 'EUR',
			data: {line_items: [{name: 'Shirt', quantity: 1, unit_price: 1000, tax_rate: 2100, reference: 'SKU-1', type: 'physical'}]}
		})

		expect(result.data.order_lines[0].name).toBe('Shirt')
		expect(result.data.order_lines[0].reference).toBe('SKU-1')
	})

	it('should build fallback line with correct tax rate', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({amount: 12.1, currency_code: 'EUR', data: {tax_amount: 2.1}})

		expect(result.data.order_lines[0].tax_rate).toBe(2100)
	})

	it('should default line item type to physical and omit reference when not provided', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({
			amount: 10,
			currency_code: 'EUR',
			data: {line_items: [{name: 'Thing', quantity: 2, unit_price: 500, tax_rate: 0}]}
		})

		expect(result.data.order_lines[0].type).toBe('physical')
		expect(result.data.order_lines[0]).not.toHaveProperty('reference')
	})

	it('should handle tax rate 0 when preTaxAmount is 0', async () => {
		const service = createService()
		;(mockClient.createSession as jest.Mock).mockResolvedValue({session_id: 's1', client_token: 'ct', payment_method_categories: []})
		;(mockClient.createHppSession as jest.Mock).mockResolvedValue({redirect_url: 'url', session_id: 'hpp_1'})

		const result = await service.initiatePayment({amount: 0, currency_code: 'EUR'})

		expect(result.data.order_lines[0].tax_rate).toBe(0)
	})
})

describe('authorizePayment', () => {
	it('should create order when authorization_token is present', async () => {
		const service = createService()
		;(mockClient.createOrder as jest.Mock).mockResolvedValue({order_id: 'o1', order_status: KlarnaOrderStatus.AUTHORIZED})

		const result = await service.authorizePayment({data: {...validPaymentData, authorization_token: 'at1'}})

		expect(result.status).toBe('authorized')
		expect(result.data.order_id).toBe('o1')
		expect(mockClient.createOrder).toHaveBeenCalledWith('at1', expect.objectContaining({merchant_reference1: 'sess_1'}))
	})

	it('should return PENDING when HPP status is not COMPLETED', async () => {
		const service = createService()
		;(mockClient.getHppSessionStatus as jest.Mock).mockResolvedValue({session_id: 'hpp1', status: KlarnaHppSessionStatus.WAITING})

		const result = await service.authorizePayment({data: {...validPaymentData, hpp_session_id: 'hpp1'}})

		expect(result.status).toBe('pending')
	})

	it('should create order when HPP is COMPLETED with authorization_token', async () => {
		const service = createService()
		;(mockClient.getHppSessionStatus as jest.Mock).mockResolvedValue({
			session_id: 'hpp1',
			status: KlarnaHppSessionStatus.COMPLETED,
			authorization_token: 'hpp_at'
		})
		;(mockClient.createOrder as jest.Mock).mockResolvedValue({order_id: 'o2', order_status: KlarnaOrderStatus.AUTHORIZED})

		const result = await service.authorizePayment({data: {...validPaymentData, hpp_session_id: 'hpp1'}})

		expect(result.status).toBe('authorized')
		expect(result.data.authorization_token).toBe('hpp_at')
		expect(result.data.order_id).toBe('o2')
	})

	it('should return AUTHORIZED without order when HPP COMPLETED but no authorization_token', async () => {
		const service = createService()
		;(mockClient.getHppSessionStatus as jest.Mock).mockResolvedValue({session_id: 'hpp1', status: KlarnaHppSessionStatus.COMPLETED})

		const result = await service.authorizePayment({data: {...validPaymentData, hpp_session_id: 'hpp1'}})

		expect(result.status).toBe('authorized')
		expect(result.data.order_id).toBeUndefined()
	})

	it('should return PENDING when neither authorization_token nor hpp_session_id exist', async () => {
		const service = createService()

		const result = await service.authorizePayment({data: validPaymentData})

		expect(result.status).toBe('pending')
	})

	it('should throw when data is invalid', async () => {
		const service = createService()

		await expect(service.authorizePayment({data: {}})).rejects.toThrow('authorization')
	})
})

describe('capturePayment', () => {
	it('should capture order with order_id and amount', async () => {
		const service = createService()
		;(mockClient.captureOrder as jest.Mock).mockResolvedValue(undefined)

		const result = await service.capturePayment({data: {...validPaymentData, order_id: 'o1'}})

		expect(mockClient.captureOrder).toHaveBeenCalledWith('o1', 1000)
		expect(result.data.session_id).toBe('sess_1')
	})

	it('should throw when order_id is missing', async () => {
		const service = createService()

		await expect(service.capturePayment({data: validPaymentData})).rejects.toThrow('order_id')
	})

	it('should throw when data is invalid', async () => {
		const service = createService()

		await expect(service.capturePayment({data: {}})).rejects.toThrow('capture')
	})
})

describe('refundPayment', () => {
	it('should refund order with converted amount', async () => {
		const service = createService()
		;(mockClient.refundOrder as jest.Mock).mockResolvedValue(undefined)

		await service.refundPayment({data: {...validPaymentData, order_id: 'o1'}, amount: 5})

		expect(mockClient.refundOrder).toHaveBeenCalledWith('o1', 500)
	})

	it('should throw when order_id is missing', async () => {
		const service = createService()

		await expect(service.refundPayment({data: validPaymentData, amount: 5})).rejects.toThrow('order_id')
	})

	it('should throw when data is invalid', async () => {
		const service = createService()

		await expect(service.refundPayment({data: {}, amount: 5})).rejects.toThrow('refund')
	})
})

describe('cancelPayment', () => {
	it('should delete authorization when authorization_token exists', async () => {
		const service = createService()
		;(mockClient.deleteAuthorization as jest.Mock).mockResolvedValue(undefined)

		await service.cancelPayment({data: {...validPaymentData, authorization_token: 'at1'}})

		expect(mockClient.deleteAuthorization).toHaveBeenCalledWith('at1')
	})

	it('should swallow 404 KlarnaApiError', async () => {
		const service = createService()
		;(mockClient.deleteAuthorization as jest.Mock).mockRejectedValue(new KlarnaApiError('not found', 404))

		await expect(service.cancelPayment({data: {...validPaymentData, authorization_token: 'at1'}})).resolves.toBeDefined()
		expect(mockLogger.warn).toHaveBeenCalled()
	})

	it('should swallow 409 KlarnaApiError', async () => {
		const service = createService()
		;(mockClient.deleteAuthorization as jest.Mock).mockRejectedValue(new KlarnaApiError('conflict', 409))

		await expect(service.cancelPayment({data: {...validPaymentData, authorization_token: 'at1'}})).resolves.toBeDefined()
	})

	it('should rethrow non-404/409 KlarnaApiError', async () => {
		const service = createService()
		;(mockClient.deleteAuthorization as jest.Mock).mockRejectedValue(new KlarnaApiError('server error', 500))

		await expect(service.cancelPayment({data: {...validPaymentData, authorization_token: 'at1'}})).rejects.toThrow('server error')
	})

	it('should rethrow non-KlarnaApiError errors', async () => {
		const service = createService()
		;(mockClient.deleteAuthorization as jest.Mock).mockRejectedValue(new Error('network'))

		await expect(service.cancelPayment({data: {...validPaymentData, authorization_token: 'at1'}})).rejects.toThrow('network')
	})

	it('should skip deletion when no authorization_token', async () => {
		const service = createService()

		await service.cancelPayment({data: validPaymentData})

		expect(mockClient.deleteAuthorization).not.toHaveBeenCalled()
	})
})

describe('deletePayment', () => {
	it('should delegate to cancelPayment', async () => {
		const service = createService()

		const result = await service.deletePayment({data: validPaymentData})

		expect(result.data.session_id).toBe('sess_1')
	})
})

describe('getPaymentStatus', () => {
	it('should return REQUIRES_MORE when no order_id but authorization_token exists', async () => {
		const service = createService()

		const result = await service.getPaymentStatus({data: {...validPaymentData, authorization_token: 'at1'}})

		expect(result.status).toBe('requires_more')
	})

	it('should return PENDING when no order_id and no authorization_token', async () => {
		const service = createService()

		const result = await service.getPaymentStatus({data: validPaymentData})

		expect(result.status).toBe('pending')
	})

	it('should return CANCELED when fraud_status is REJECTED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.REJECTED,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('canceled')
	})

	it('should return REQUIRES_MORE when fraud_status is PENDING', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.PENDING,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('requires_more')
	})

	it('should return CAPTURED when status is CAPTURED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.CAPTURED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('captured')
	})

	it('should return CAPTURED when status is PART_CAPTURED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.PART_CAPTURED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('captured')
	})

	it('should return CANCELED when status is CANCELLED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.CANCELLED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('canceled')
	})

	it('should return CANCELED when status is EXPIRED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.EXPIRED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('canceled')
	})

	it('should return AUTHORIZED for other statuses when fraud is ACCEPTED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getPaymentStatus({data: {...validPaymentData, order_id: 'o1'}})

		expect(result.status).toBe('authorized')
	})
})

describe('updatePayment', () => {
	it('should update session and return updated data', async () => {
		const service = createService()
		;(mockClient.updateSession as jest.Mock).mockResolvedValue(undefined)

		const result = await service.updatePayment({data: validPaymentData, amount: 20, currency_code: 'EUR'})

		expect(mockClient.updateSession).toHaveBeenCalledWith('sess_1', expect.objectContaining({order_amount: 2000}))
		expect(result.data.order_amount).toBe(2000)
	})

	it('should fall back to data.purchase_currency when input.currency_code absent', async () => {
		const service = createService()
		;(mockClient.updateSession as jest.Mock).mockResolvedValue(undefined)

		const result = await service.updatePayment({data: validPaymentData, amount: 20})

		expect(result.data.purchase_currency).toBe('EUR')
	})

	it('should use new tax_amount from input.data when provided', async () => {
		const service = createService()
		;(mockClient.updateSession as jest.Mock).mockResolvedValue(undefined)

		const result = await service.updatePayment({data: {...validPaymentData, tax_amount: 3}, amount: 20, currency_code: 'EUR'})

		expect(result.data.order_tax_amount).toBe(300)
	})

	it('should fall back to existing order_tax_amount when no tax_amount in input', async () => {
		const service = createService()
		;(mockClient.updateSession as jest.Mock).mockResolvedValue(undefined)

		const result = await service.updatePayment({data: {...validPaymentData, order_tax_amount: 174}, amount: 20, currency_code: 'EUR'})

		expect(result.data.order_tax_amount).toBe(174)
	})

	it('should pass line_items from input through to order lines', async () => {
		const service = createService()
		;(mockClient.updateSession as jest.Mock).mockResolvedValue(undefined)

		const result = await service.updatePayment({
			data: {...validPaymentData, line_items: [{name: 'Hat', quantity: 1, unit_price: 2000, tax_rate: 2100}]},
			amount: 20,
			currency_code: 'EUR'
		})

		expect(result.data.order_lines[0].name).toBe('Hat')
	})
})

describe('retrievePayment', () => {
	it('should return raw data when it is not valid KlarnaPaymentData', async () => {
		const service = createService()

		const result = await service.retrievePayment({data: {random: 'stuff'}})

		expect(result.data).toEqual({random: 'stuff'})
		expect(mockClient.getSession).not.toHaveBeenCalled()
	})

	it('should return raw data when data is null', async () => {
		const service = createService()

		const result = await service.retrievePayment({data: null})

		expect(result.data).toBeNull()
		expect(mockClient.getSession).not.toHaveBeenCalled()
	})

	it('should fetch session and return merged data when data is valid', async () => {
		const service = createService()
		;(mockClient.getSession as jest.Mock).mockResolvedValue({
			session_id: 'sess_1',
			client_token: 'new_ct',
			payment_method_categories: [{identifier: 'pay_later'}]
		})

		const result = await service.retrievePayment({data: validPaymentData})

		expect(result.data.client_token).toBe('new_ct')
		expect(result.data.payment_method_categories[0].identifier).toBe('pay_later')
	})
})

describe('getWebhookActionAndData', () => {
	it('should return NOT_SUPPORTED when orderId is missing', async () => {
		const service = createService()

		const result = await service.getWebhookActionAndData({data: {event_type: 'FRAUD_RISK_ACCEPTED'}, rawData: '', headers: {}})

		expect(result.action).toBe('not_supported')
	})

	it('should return NOT_SUPPORTED when eventType is missing', async () => {
		const service = createService()

		const result = await service.getWebhookActionAndData({data: {order_id: 'o1'}, rawData: '', headers: {}})

		expect(result.action).toBe('not_supported')
	})

	it('should return AUTHORIZED for FRAUD_RISK_ACCEPTED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000,
			merchant_reference1: 'sess_1'
		})

		const result = await service.getWebhookActionAndData({
			data: {event_type: KlarnaWebhookEvent.FRAUD_RISK_ACCEPTED, order_id: 'o1'},
			rawData: '',
			headers: {}
		})

		expect(result.action).toBe('authorized')
		expect(result.data?.session_id).toBe('sess_1')
	})

	it('should return FAILED for FRAUD_RISK_REJECTED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.REJECTED,
			order_amount: 1000,
			merchant_reference1: 'sess_1'
		})

		const result = await service.getWebhookActionAndData({
			data: {event_type: KlarnaWebhookEvent.FRAUD_RISK_REJECTED, order_id: 'o1'},
			rawData: '',
			headers: {}
		})

		expect(result.action).toBe('failed')
	})

	it('should return FAILED for FRAUD_RISK_STOPPED', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.REJECTED,
			order_amount: 1000
		})

		const result = await service.getWebhookActionAndData({
			data: {event_type: KlarnaWebhookEvent.FRAUD_RISK_STOPPED, order_id: 'o1'},
			rawData: '',
			headers: {}
		})

		expect(result.action).toBe('failed')
	})

	it('should default session_id to empty string when merchant_reference1 is undefined', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getWebhookActionAndData({
			data: {event_type: KlarnaWebhookEvent.FRAUD_RISK_ACCEPTED, order_id: 'o1'},
			rawData: '',
			headers: {}
		})

		expect(result.data?.session_id).toBe('')
	})

	it('should return NOT_SUPPORTED for unknown event type', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockResolvedValue({
			order_id: 'o1',
			status: KlarnaOrderStatus.AUTHORIZED,
			fraud_status: KlarnaFraudStatus.ACCEPTED,
			order_amount: 1000
		})

		const result = await service.getWebhookActionAndData({data: {event_type: 'UNKNOWN_EVENT', order_id: 'o1'}, rawData: '', headers: {}})

		expect(result.action).toBe('not_supported')
	})

	it('should return FAILED when getOrder throws', async () => {
		const service = createService()
		;(mockClient.getOrder as jest.Mock).mockRejectedValue(new Error('api down'))

		const result = await service.getWebhookActionAndData({
			data: {event_type: KlarnaWebhookEvent.FRAUD_RISK_ACCEPTED, order_id: 'o1'},
			rawData: '',
			headers: {}
		})

		expect(result.action).toBe('failed')
		expect(result.data?.session_id).toBe('')
		expect(mockLogger.error).toHaveBeenCalled()
	})
})

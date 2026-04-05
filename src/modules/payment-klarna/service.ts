import {AbstractPaymentProvider, BigNumber, MathBN, MedusaError, PaymentActions, PaymentSessionStatus} from '@medusajs/framework/utils'
import type {
	BigNumberInput,
	InitiatePaymentInput,
	InitiatePaymentOutput,
	AuthorizePaymentInput,
	AuthorizePaymentOutput,
	CapturePaymentInput,
	CapturePaymentOutput,
	RefundPaymentInput,
	RefundPaymentOutput,
	CancelPaymentInput,
	CancelPaymentOutput,
	DeletePaymentInput,
	DeletePaymentOutput,
	GetPaymentStatusInput,
	GetPaymentStatusOutput,
	UpdatePaymentInput,
	UpdatePaymentOutput,
	RetrievePaymentInput,
	RetrievePaymentOutput,
	ProviderWebhookPayload,
	WebhookActionResult,
	Logger,
} from '@medusajs/framework/types'
import {
	KlarnaClient,
	KlarnaApiError,
	KlarnaFraudStatus,
	KlarnaHppSessionStatus,
	KlarnaOrderStatus,
	KlarnaWebhookEvent,
	VALID_ENVIRONMENTS,
	VALID_REGIONS,
} from './client'
import type {KlarnaEnvironment, KlarnaRegion, KlarnaOrderLine, KlarnaOrderLineType, KlarnaPaymentMethodCategory, KlarnaSessionRequest} from './client'

type InjectedDependencies = {
	logger: Logger
}

// --- Configuration ---

export type KlarnaOptions = {
	apiKey: string
	environment: KlarnaEnvironment
	region: KlarnaRegion
	defaultCountry: string
	defaultLocale: string
	storefrontUrl: string
	callbackPath?: string
	checkoutPath?: string
}

// --- Input type for line items passed via data.line_items ---

export type KlarnaLineItemInput = {
	name: string
	quantity: number
	unit_price: number
	tax_rate: number
	reference?: string
	type?: KlarnaOrderLineType
}

// --- Internal data stored in PaymentSession.data ---

export type KlarnaSessionData = {
	session_id: string
	client_token: string
	payment_method_categories: Array<KlarnaPaymentMethodCategory>
	purchase_country: string
	purchase_currency: string
	locale: string
	order_amount: number
	order_tax_amount: number
	order_lines: Array<KlarnaOrderLine>
	hpp_redirect_url?: string
	hpp_session_id?: string
}

export type KlarnaPaymentData = KlarnaSessionData & {
	authorization_token?: string
	order_id?: string
	order_status?: KlarnaOrderStatus
}

function isKlarnaPaymentData(data: unknown): data is KlarnaPaymentData {
	if (typeof data !== 'object' || data === null) {
		return false
	}
	const record = data as Record<string, unknown>
	return typeof record.session_id === 'string' && typeof record.purchase_currency === 'string'
}

// --- Zero-decimal currencies (no minor unit conversion needed) ---

const ZERO_DECIMAL_CURRENCIES = new Set([
	'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW',
	'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])

// --- Service ---

class KlarnaPaymentService extends AbstractPaymentProvider<KlarnaOptions> {
	static identifier = 'klarna'

	protected logger_: Logger
	protected client_: KlarnaClient

	constructor(container: InjectedDependencies, config: KlarnaOptions) {
		const apiKey = config.apiKey.includes(':') ? Buffer.from(config.apiKey).toString('base64') : config.apiKey
		const storefrontUrl = config.storefrontUrl.replace(/\/+$/, '')
		super(container, {...config, apiKey, storefrontUrl})
		this.logger_ = container.logger
		this.client_ = new KlarnaClient(config.environment, config.region, apiKey, this.logger_)
	}

	static validateOptions(options: Record<string, unknown>): void {
		if (!options.apiKey || typeof options.apiKey !== 'string') {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Required option `apiKey` is missing in Klarna payment provider options.')
		}

		const apiKey = options.apiKey
		const isRawCredentials = apiKey.includes(':')
		const isValidBase64 = /^[A-Za-z0-9+/]+=*$/.test(apiKey)

		if (!isRawCredentials && !isValidBase64) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				'Option `apiKey` must be either base64-encoded "username:password" or a raw "username:password" string.'
			)
		}

		if (isValidBase64 && !isRawCredentials) {
			const decoded = Buffer.from(apiKey, 'base64').toString('utf-8')
			if (!decoded.includes(':')) {
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					'Option `apiKey` does not decode to a valid "username:password" pair. Provide base64(username:password) or raw "username:password".'
				)
			}
		}
		if (!options.environment || !VALID_ENVIRONMENTS.includes(options.environment as KlarnaEnvironment)) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				`Invalid option \`environment\`: "${String(options.environment)}". Must be one of: ${VALID_ENVIRONMENTS.join(', ')}.`
			)
		}
		if (!options.region || !VALID_REGIONS.includes(options.region as KlarnaRegion)) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				`Invalid option \`region\`: "${String(options.region)}". Must be one of: ${VALID_REGIONS.join(', ')}.`
			)
		}
		if (!options.defaultCountry || typeof options.defaultCountry !== 'string' || options.defaultCountry.length !== 2) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				'Required option `defaultCountry` must be a 2-letter ISO 3166 alpha-2 country code (e.g. "NL", "SE", "US").'
			)
		}
		if (!options.defaultLocale || typeof options.defaultLocale !== 'string') {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Required option `defaultLocale` must be an RFC 1766 locale (e.g. "nl-NL", "en-US").')
		}
		if (!options.storefrontUrl || typeof options.storefrontUrl !== 'string') {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				'Required option `storefrontUrl` must be the base URL of your storefront (e.g. "http://localhost:3000").'
			)
		}
		if (options.callbackPath && (typeof options.callbackPath !== 'string' || !options.callbackPath.startsWith('/'))) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Option `callbackPath` must start with "/" (e.g. "/order/callback/klarna").')
		}
		if (options.checkoutPath && (typeof options.checkoutPath !== 'string' || !options.checkoutPath.startsWith('/'))) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, 'Option `checkoutPath` must start with "/" (e.g. "/checkout").')
		}
	}

	// --- Amount conversion ---

	private toMinorUnits(amount: BigNumberInput, currencyCode: string): number {
		const upper = currencyCode.toUpperCase()
		if (ZERO_DECIMAL_CURRENCIES.has(upper)) {
			return Math.round(new BigNumber(amount).numeric)
		}
		return Math.round(new BigNumber(MathBN.mult(amount, 100)).numeric)
	}

	// --- Builders ---

	private buildOrderLines(amountMinorUnits: number, taxAmountMinorUnits: number, lineItems?: Array<KlarnaLineItemInput>): Array<KlarnaOrderLine> {
		if (lineItems && lineItems.length > 0) {
			return lineItems.map(item => {
				const totalAmount = item.unit_price * item.quantity
				const totalTaxAmount = Math.round(totalAmount - totalAmount * (10000 / (10000 + item.tax_rate)))

				return {
					name: item.name,
					quantity: item.quantity,
					unit_price: item.unit_price,
					total_amount: totalAmount,
					total_tax_amount: totalTaxAmount,
					tax_rate: item.tax_rate,
					type: item.type || 'physical',
					...(item.reference && {reference: item.reference}),
				}
			})
		}

		const preTaxAmount = amountMinorUnits - taxAmountMinorUnits
		const taxRate = preTaxAmount > 0 ? Math.round((taxAmountMinorUnits / preTaxAmount) * 10000) : 0

		return [
			{
				name: 'Order total',
				quantity: 1,
				unit_price: amountMinorUnits,
				total_amount: amountMinorUnits,
				total_tax_amount: taxAmountMinorUnits,
				tax_rate: taxRate,
				type: 'physical',
			},
		]
	}

	private buildSessionRequest(amountMinorUnits: number, taxAmountMinorUnits: number, currencyCode: string, data?: Record<string, any>): KlarnaSessionRequest {
		const purchaseCountry = (data?.purchase_country as string) || this.config.defaultCountry
		const locale = (data?.locale as string) || this.config.defaultLocale
		const lineItems = data?.line_items as Array<KlarnaLineItemInput> | undefined

		return {
			acquiring_channel: 'ECOMMERCE',
			purchase_country: purchaseCountry.toUpperCase(),
			purchase_currency: currencyCode.toUpperCase(),
			locale,
			order_amount: amountMinorUnits,
			order_tax_amount: taxAmountMinorUnits,
			order_lines: this.buildOrderLines(amountMinorUnits, taxAmountMinorUnits, lineItems),
			intent: 'buy',
		}
	}

	private requirePaymentData(data: Record<string, any> | undefined, operation: string): KlarnaPaymentData {
		if (!isKlarnaPaymentData(data)) {
			throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `No valid Klarna payment data found for ${operation}.`)
		}
		return data
	}

	// --- Payment lifecycle methods ---

	async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
		const {amount, currency_code, data} = input
		const inputData = data as Record<string, any> | undefined
		const amountMinorUnits = this.toMinorUnits(amount, currency_code)
		const taxAmount = inputData?.tax_amount as BigNumberInput | undefined
		const taxAmountMinorUnits = taxAmount ? this.toMinorUnits(taxAmount, currency_code) : 0
		this.logger_.info(`Klarna initiatePayment: ${amountMinorUnits} ${currency_code} (tax: ${taxAmountMinorUnits})`)

		const sessionRequest = this.buildSessionRequest(amountMinorUnits, taxAmountMinorUnits, currency_code, inputData)
		const session = await this.client_.createSession(sessionRequest)

		const storefrontUrl = this.config.storefrontUrl
		const lang = sessionRequest.locale.split('-')[0]
		const callbackPath = this.config.callbackPath || `/${lang}/order/callback/klarna`
		const checkoutPath = this.config.checkoutPath || `/${lang}/checkout`
		const paymentSessionUrl = `${this.client_.baseUrl}/payments/v1/sessions/${session.session_id}`

		const hpp = await this.client_.createHppSession({
			payment_session_url: paymentSessionUrl,
			merchant_urls: {
				success: `${storefrontUrl}${callbackPath}?session_id=${session.session_id}&authorization_token={{authorization_token}}`,
				cancel: `${storefrontUrl}${checkoutPath}`,
				back: `${storefrontUrl}${checkoutPath}`,
				failure: `${storefrontUrl}${checkoutPath}?error=payment_failed`,
				error: `${storefrontUrl}${checkoutPath}?error=payment_error`,
			},
			options: {
				place_order_mode: 'NONE',
				purchase_type: 'BUY',
			},
		})

		const sessionData: KlarnaSessionData = {
			session_id: session.session_id,
			client_token: session.client_token,
			payment_method_categories: session.payment_method_categories,
			purchase_country: sessionRequest.purchase_country,
			purchase_currency: sessionRequest.purchase_currency,
			locale: sessionRequest.locale,
			order_amount: amountMinorUnits,
			order_tax_amount: taxAmountMinorUnits,
			order_lines: sessionRequest.order_lines,
			hpp_redirect_url: hpp.redirect_url,
			hpp_session_id: hpp.session_id,
		}

		return {
			id: session.session_id,
			data: sessionData,
		}
	}

	async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
		const data = this.requirePaymentData(input.data, 'authorization')
		this.logger_.info(`Klarna authorizePayment: session=${data.session_id}`)

		const orderBody = {
			purchase_country: data.purchase_country,
			purchase_currency: data.purchase_currency,
			order_amount: data.order_amount,
			order_tax_amount: data.order_tax_amount,
			order_lines: data.order_lines,
			merchant_reference1: data.session_id,
		}

		if (data.authorization_token) {
			const order = await this.client_.createOrder(data.authorization_token, orderBody)

			return {
				data: {
					...data,
					order_id: order.order_id,
					order_status: order.order_status,
				},
				status: PaymentSessionStatus.AUTHORIZED,
			}
		}

		if (data.hpp_session_id) {
			const hppStatus = await this.client_.getHppSessionStatus(data.hpp_session_id)

			if (hppStatus.status !== KlarnaHppSessionStatus.COMPLETED) {
				return {data, status: PaymentSessionStatus.PENDING}
			}

			if (hppStatus.authorization_token) {
				const order = await this.client_.createOrder(hppStatus.authorization_token, orderBody)

				return {
					data: {
						...data,
						authorization_token: hppStatus.authorization_token,
						order_id: order.order_id,
						order_status: order.order_status,
					},
					status: PaymentSessionStatus.AUTHORIZED,
				}
			}

			return {data, status: PaymentSessionStatus.AUTHORIZED}
		}

		return {data, status: PaymentSessionStatus.PENDING}
	}

	async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
		const data = this.requirePaymentData(input.data, 'capture')
		const orderId = data.order_id

		if (!orderId) {
			throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, 'No Klarna order_id found. Cannot capture a payment that has not been authorized.')
		}

		this.logger_.info(`Klarna capturePayment: order=${orderId}, amount=${data.order_amount}`)
		await this.client_.captureOrder(orderId, data.order_amount)

		return {data: {...data}}
	}

	async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
		const data = this.requirePaymentData(input.data, 'refund')
		const orderId = data.order_id

		if (!orderId) {
			throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, 'No Klarna order_id found. Cannot refund a payment that has not been captured.')
		}

		const refundAmount = this.toMinorUnits(input.amount, data.purchase_currency)
		this.logger_.info(`Klarna refundPayment: order=${orderId}, amount=${refundAmount}`)
		await this.client_.refundOrder(orderId, refundAmount)

		return {data: {...data}}
	}

	async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
		const data = this.requirePaymentData(input.data, 'cancel')
		this.logger_.info(`Klarna cancelPayment: session=${data.session_id}, authorization=${data.authorization_token}`)

		if (data.authorization_token) {
			try {
				await this.client_.deleteAuthorization(data.authorization_token)
			} catch (error) {
				if (error instanceof KlarnaApiError && (error.statusCode === 404 || error.statusCode === 409)) {
					this.logger_.warn(`Klarna cancelPayment: authorization ${data.authorization_token} already expired or consumed (${error.statusCode})`)
				} else {
					throw error
				}
			}
		}

		return {data: {...data}}
	}

	async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
		return this.cancelPayment(input)
	}

	async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
		const data = this.requirePaymentData(input.data, 'getPaymentStatus')

		if (!data.order_id) {
			if (data.authorization_token) {
				return {status: PaymentSessionStatus.REQUIRES_MORE}
			}
			return {status: PaymentSessionStatus.PENDING}
		}

		const order = await this.client_.getOrder(data.order_id)

		switch (order.fraud_status) {
			case KlarnaFraudStatus.REJECTED:
				return {status: PaymentSessionStatus.CANCELED}
			case KlarnaFraudStatus.PENDING:
				return {status: PaymentSessionStatus.REQUIRES_MORE}
		}

		switch (order.status) {
			case KlarnaOrderStatus.CAPTURED:
			case KlarnaOrderStatus.PART_CAPTURED:
				return {status: PaymentSessionStatus.CAPTURED}
			case KlarnaOrderStatus.CANCELLED:
			case KlarnaOrderStatus.EXPIRED:
				return {status: PaymentSessionStatus.CANCELED}
			default:
				return {status: PaymentSessionStatus.AUTHORIZED}
		}
	}

	async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
		const data = this.requirePaymentData(input.data, 'update')
		const sessionId = data.session_id

		const currencyCode = input.currency_code || data.purchase_currency
		const amountMinorUnits = this.toMinorUnits(input.amount, currencyCode)
		const inputData = input.data as Record<string, any> | undefined
		const taxAmount = inputData?.tax_amount as BigNumberInput | undefined
		const taxAmountMinorUnits = taxAmount ? this.toMinorUnits(taxAmount, currencyCode) : data.order_tax_amount
		const lineItems = inputData?.line_items as Array<KlarnaLineItemInput> | undefined
		const orderLines = this.buildOrderLines(amountMinorUnits, taxAmountMinorUnits, lineItems)

		await this.client_.updateSession(sessionId, {
			purchase_country: data.purchase_country,
			purchase_currency: currencyCode.toUpperCase(),
			locale: data.locale,
			order_amount: amountMinorUnits,
			order_tax_amount: taxAmountMinorUnits,
			order_lines: orderLines,
		})

		return {
			data: {
				...data,
				order_amount: amountMinorUnits,
				order_tax_amount: taxAmountMinorUnits,
				order_lines: orderLines,
				purchase_currency: currencyCode.toUpperCase(),
			},
		}
	}

	async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
		if (!isKlarnaPaymentData(input.data)) {
			return {data: input.data}
		}

		const data = input.data
		const session = await this.client_.getSession(data.session_id)

		return {
			data: {
				...data,
				client_token: session.client_token,
				payment_method_categories: session.payment_method_categories,
			},
		}
	}

	async getWebhookActionAndData(input: ProviderWebhookPayload['payload']): Promise<WebhookActionResult> {
		const webhookData = input.data as Record<string, any>
		const eventType = webhookData?.event_type as string | undefined
		const orderId = webhookData?.order_id as string | undefined

		this.logger_.info(`Klarna webhook received: event_type=${eventType}, order_id=${orderId}`)

		if (!orderId || !eventType) {
			return {action: PaymentActions.NOT_SUPPORTED}
		}

		try {
			const order = await this.client_.getOrder(orderId)
			const sessionId = order.merchant_reference1 || ''
			const amount = new BigNumber(order.order_amount)
			const payloadData = {session_id: sessionId, amount}

			switch (eventType) {
				case KlarnaWebhookEvent.FRAUD_RISK_ACCEPTED:
					this.logger_.info(`Klarna fraud accepted: order=${orderId}, session=${sessionId}`)
					return {action: PaymentActions.AUTHORIZED, data: payloadData}
				case KlarnaWebhookEvent.FRAUD_RISK_REJECTED:
				case KlarnaWebhookEvent.FRAUD_RISK_STOPPED:
					this.logger_.warn(`Klarna fraud rejected: order=${orderId}, session=${sessionId}`)
					return {action: PaymentActions.FAILED, data: payloadData}
				default:
					this.logger_.info(`Klarna unhandled webhook event: ${eventType}`)
					return {action: PaymentActions.NOT_SUPPORTED, data: payloadData}
			}
		} catch (error) {
			this.logger_.error(`Klarna webhook processing failed for order=${orderId}: ${error}`)
			return {
				action: PaymentActions.FAILED,
				data: {session_id: '', amount: new BigNumber(0)},
			}
		}
	}
}

export default KlarnaPaymentService

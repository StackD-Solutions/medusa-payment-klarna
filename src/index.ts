import {ModuleProvider, Modules} from '@medusajs/framework/utils'
import KlarnaPaymentService from './modules/payment-klarna/service'

export type {KlarnaOptions, KlarnaLineItemInput, KlarnaSessionData, KlarnaPaymentData} from './modules/payment-klarna/service'
export {KlarnaApiError, KlarnaFraudStatus, KlarnaOrderStatus, KlarnaHppSessionStatus, KlarnaWebhookEvent} from './modules/payment-klarna/client'
export type {KlarnaOrderLine, KlarnaPaymentMethodCategory, KlarnaOrderResponse, KlarnaOrderDetails} from './modules/payment-klarna/client'

export default ModuleProvider(Modules.PAYMENT, {
  services: [KlarnaPaymentService],
})

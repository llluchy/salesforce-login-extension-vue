/** SOQL 工具默认配置（精简自白名单快照） */

export const DEFAULT_STANDARD_WHITELIST = [
  'Account', 'Contact', 'Opportunity', 'Case', 'Lead', 'Task', 'Event', 'User',
  'Campaign', 'CampaignMember', 'Contract', 'Order', 'OrderItem', 'Product2',
  'Pricebook2', 'PricebookEntry', 'Asset', 'WorkOrder', 'WorkOrderLineItem',
  'EmailMessage', 'ContentVersion', 'AsyncApexJob', 'Individual'
]

export function getObjectKind(apiName) {
  if (!apiName) return 'business'
  if (apiName.endsWith('__Share')) return 'share'
  if (apiName.endsWith('__mdt')) return 'metadata'
  if (apiName.startsWith('__')) return 'system'
  if (apiName.endsWith('__c')) return 'custom'
  return 'standard'
}

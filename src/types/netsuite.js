/**
 * Enum de tipos de conta do NetSuite
 */
export const AccountType = Object.freeze({
  Bank: 'Bank',
  AcctRec: 'AcctRec',
  OthCurrAsset: 'OthCurrAsset',
  FixedAsset: 'FixedAsset',
  OthAsset: 'OthAsset',
  AcctPay: 'AcctPay',
  OthCurrLiab: 'OthCurrLiab',
  LongTermLiab: 'LongTermLiab',
  Equity: 'Equity',
  Income: 'Income',
  COGS: 'COGS',
  Expense: 'Expense',
  DeferRevenue: 'DeferRevenue',
  DeferExpense: 'DeferExpense',
  UnbilledRec: 'UnbilledRec',
});

/**
 * Lista de todos os AccountTypes validos
 */
export const VALID_ACCOUNT_TYPES = Object.values(AccountType);
